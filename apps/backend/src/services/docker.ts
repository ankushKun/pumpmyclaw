import Docker from "dockerode";
import { mkdirSync, existsSync, chmodSync } from "fs";
import { resolve } from "path";
import { spawn } from "child_process";

const DOCKER_SOCKET =
  process.env.DOCKER_HOST ||
  process.env.DOCKER_SOCKET ||
  "/var/run/docker.sock";

const docker = new Docker({ socketPath: DOCKER_SOCKET });

const BASE_IMAGE_NAME = "pmc-base:latest";
const IMAGE_NAME = "pmc-openclaw-instance:latest";
const CONTAINER_PREFIX = "pmc-instance-";

// Path to instance Dockerfile directory (relative to backend)
const INSTANCE_DOCKERFILE_DIR = resolve(__dirname, "../../../instance");
const BASE_IMAGE_DOCKERFILE_DIR = resolve(__dirname, "../../../instance/base-image");

let imageReady = false;
let imageBuildPromise: Promise<void> | null = null;

/**
 * Base directory on the host where per-instance OpenClaw data is stored.
 * Each instance gets a subdirectory: <INSTANCES_DATA_DIR>/instance-<id>/
 * This is bind-mounted into the container at /home/openclaw/.openclaw
 * so sessions, workspace, credentials, etc. persist across container recreation.
 */
const INSTANCES_DATA_DIR =
  process.env.INSTANCES_DATA_DIR || "./data/instances";

export interface InstanceConfig {
  instanceId: number;
  userId: number;
  telegramOwnerId: string;
  telegramBotToken: string;
  openrouterApiKey: string;
  model: string;
  /** "openrouter" | "openai-codex" */
  llmProvider?: string;
  /** Plaintext OpenAI access token (JWT) — only set when llmProvider is "openai-codex" */
  openaiAccessToken?: string;
  /** Plaintext OpenAI refresh token */
  openaiRefreshToken?: string;
  /** OpenAI account ID */
  openaiAccountId?: string;
}

/**
 * Get the host-side data directory for a specific user.
 * Uses telegramId (not instanceId) so data persists across instance recreation.
 * Creates it and all required subdirectories if they don't exist.
 * Sets permissions to 777 so any container user can write.
 */
function getUserDataDir(telegramId: string): string {
  // Docker requires absolute paths for bind mounts
  // Use user-{telegramId} so data persists even if instance is deleted and recreated
  const dir = resolve(INSTANCES_DATA_DIR, `user-${telegramId}`);
  
  // If the main directory already exists, just return it
  // The container's entrypoint script handles permissions and subdirectory creation
  // This avoids EACCES errors when the directory is owned by root from a previous Docker run
  if (existsSync(dir)) {
    console.log(`[docker] User data dir exists: ${dir}`);
    return dir;
  }
  
  // Create main dir and all subdirectories needed by OpenClaw
  const subdirs = ["workspace", "skills", "agents", "credentials"];
  for (const subdir of ["", ...subdirs]) {
    const path = subdir ? resolve(dir, subdir) : dir;
    mkdirSync(path, { recursive: true, mode: 0o777 });
  }
  
  // Set permissions so any container user can write
  try {
    chmodSync(dir, 0o777);
    for (const subdir of subdirs) {
      chmodSync(resolve(dir, subdir), 0o777);
    }
  } catch (err) {
    console.log(`[docker] Could not chmod ${dir}:`, err);
  }
  
  console.log(`[docker] User data dir created: ${dir}`);
  
  return dir;
}

/**
 * Check if a Docker image exists locally.
 */
async function checkImageExists(imageName: string): Promise<boolean> {
  try {
    await docker.getImage(imageName).inspect();
    return true;
  } catch {
    return false;
  }
}

/**
 * Tracks the last time we logged a RUN output line per build step,
 * so we can throttle noisy output (apt-get, npm install, etc.)
 * to at most one line every N seconds.
 */
const lastRunLog: Record<string, number> = {};
const RUN_LOG_INTERVAL_MS = 5_000; // log RUN output at most every 5s

/**
 * Filter a build output line and log it if meaningful.
 * BuildKit uses "#N [stage N/M] CMD" format.
 * Classic builder uses "Step N/M : CMD" format.
 * BuildKit RUN output uses "#N <elapsed> <output>" format.
 */
function logBuildLine(raw: string): void {
  const line = raw.trim();
  if (!line) return;

  // BuildKit step lines: "#5 [2/6] COPY ..." or "#7 [3/6] RUN ..."
  if (/^#\d+\s+\[\d+\/\d+\]\s+/.test(line)) {
    console.log(`[docker]   ${line}`);
    return;
  }

  // BuildKit DONE/CACHED lines: "#5 DONE 0.3s" or "#5 CACHED"
  if (/^#\d+\s+(DONE|CACHED)/.test(line)) {
    console.log(`[docker]   ${line}`);
    return;
  }

  // BuildKit exporting: "#11 exporting to image"
  if (/^#\d+\s+exporting/.test(line)) {
    console.log(`[docker]   ${line}`);
    return;
  }

  // BuildKit RUN output: "#8 42.1 Installing OpenClaw..." (step, elapsed, text)
  // Throttled to avoid spamming hundreds of apt/npm lines
  const runOutput = line.match(/^#(\d+)\s+[\d.]+\s+(.+)/);
  if (runOutput) {
    const stepId = runOutput[1];
    const text = runOutput[2];
    const now = Date.now();
    const last = lastRunLog[stepId] || 0;
    if (now - last >= RUN_LOG_INTERVAL_MS) {
      // Truncate long lines (apt-get output can be very wide)
      const display = text.length > 120 ? text.slice(0, 117) + "..." : text;
      console.log(`[docker]   #${stepId} ${display}`);
      lastRunLog[stepId] = now;
    }
    return;
  }

  // Classic builder: "Step 2/6 : RUN ..."
  if (/^Step\s+\d+\/\d+/i.test(line)) {
    console.log(`[docker]   ${line}`);
    return;
  }

  // Named stages or FROM lines
  if (line.includes("naming to")) {
    console.log(`[docker]   ${line}`);
    return;
  }
}

/**
 * Build a Docker image with streaming build output.
 * Uses --progress=plain so BuildKit outputs readable line-by-line logs
 * instead of the interactive terminal UI.
 */
async function buildDockerImage(imageName: string, contextDir: string, buildArgs?: string[]): Promise<void> {
  console.log(`[docker] Building ${imageName} from ${contextDir}`);

  if (!existsSync(contextDir)) {
    throw new Error(`Dockerfile directory not found: ${contextDir}`);
  }

  const start = Date.now();

  return new Promise((resolve, reject) => {
    const args = ["build", "--progress=plain", "-t", imageName, ...(buildArgs || []), "."];
    const proc = spawn("docker", args, {
      cwd: contextDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrTail: string[] = [];

    // BuildKit with --progress=plain sends output to both stdout and stderr
    proc.stdout.on("data", (data) => {
      for (const line of data.toString().split("\n")) {
        logBuildLine(line);
      }
    });

    proc.stderr.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        logBuildLine(line);
        // Keep last 30 lines for error reporting
        if (line.trim()) {
          stderrTail.push(line.trim());
          if (stderrTail.length > 30) stderrTail.shift();
        }
      }
    });

    proc.on("close", (code) => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[docker] Built ${imageName} in ${elapsed}s`);
        resolve();
      } else {
        console.error(`[docker] Build of ${imageName} failed (exit ${code}, ${elapsed}s):`);
        for (const line of stderrTail.slice(-20)) {
          console.error(`[docker]   ${line}`);
        }
        reject(new Error(`Docker build of ${imageName} failed with exit code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn docker build: ${err.message}`));
    });
  });
}

/**
 * Build the base image if it doesn't exist.
 * The base image contains Node.js 22, OpenClaw, and utilities.
 * This is the slow build (~5-6 min first time).
 */
async function ensureBaseImage(): Promise<void> {
  const exists = await checkImageExists(BASE_IMAGE_NAME);
  if (exists) {
    console.log(`[docker] Base image ${BASE_IMAGE_NAME} exists`);
    return;
  }

  console.log(`[docker] Base image ${BASE_IMAGE_NAME} not found — building (this takes 5-6 minutes the first time)...`);
  await buildDockerImage(BASE_IMAGE_NAME, BASE_IMAGE_DOCKERFILE_DIR);
}

/**
 * Build the instance image on top of the base image.
 * This is the fast build (~1s) — just copies skills, workspace, and scripts.
 */
async function buildInstanceImage(): Promise<void> {
  await buildDockerImage(IMAGE_NAME, INSTANCE_DOCKERFILE_DIR, [
    "--build-arg", `BASE_IMAGE=${BASE_IMAGE_NAME}`
  ]);
}

/**
 * Verify Docker is reachable and responsive.
 */
async function checkDockerConnection(): Promise<void> {
  try {
    await docker.ping();
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("ENOENT") || msg.includes("ECONNREFUSED")) {
      throw new Error(
        `Cannot connect to Docker at ${DOCKER_SOCKET}. Is Docker running?`
      );
    }
    throw new Error(`Docker connection failed: ${msg}`);
  }
}

/**
 * Ensure both Docker images are ready.
 * Called once on backend startup. Builds whatever is missing.
 * Concurrent calls share the same promise (no double-builds).
 */
export async function ensureImageReady(): Promise<void> {
  if (imageReady) return;

  if (imageBuildPromise) {
    await imageBuildPromise;
    return;
  }

  imageBuildPromise = (async () => {
    const start = Date.now();
    console.log("[docker] Checking Docker images...");

    // 1. Verify Docker is reachable
    await checkDockerConnection();
    console.log("[docker] Docker daemon is reachable");

    // 2. Check what we have
    const [baseExists, instanceExists] = await Promise.all([
      checkImageExists(BASE_IMAGE_NAME),
      checkImageExists(IMAGE_NAME),
    ]);

    if (baseExists && instanceExists) {
      console.log("[docker] All images ready — nothing to build");
      imageReady = true;
      return;
    }

    // 3. Build base image if missing (slow, ~5-6 min first time)
    if (!baseExists) {
      console.log(`[docker] Base image missing — building ${BASE_IMAGE_NAME}...`);
      console.log("[docker] This downloads Node.js 22, OpenClaw, and dependencies (~5-6 min first time)");
      await buildDockerImage(BASE_IMAGE_NAME, BASE_IMAGE_DOCKERFILE_DIR);
    } else {
      console.log(`[docker] Base image ${BASE_IMAGE_NAME} exists`);
    }

    // 4. Build instance image (fast, <1s — just copies config files)
    if (!instanceExists) {
      console.log(`[docker] Instance image missing — building ${IMAGE_NAME}...`);
      await buildDockerImage(IMAGE_NAME, INSTANCE_DOCKERFILE_DIR, [
        "--build-arg", `BASE_IMAGE=${BASE_IMAGE_NAME}`,
      ]);
    } else {
      console.log(`[docker] Instance image ${IMAGE_NAME} exists`);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[docker] All images ready (${elapsed}s total)`);
    imageReady = true;
  })().finally(() => {
    imageBuildPromise = null;
  });

  await imageBuildPromise;
}

/**
 * Create and start a new Docker container for an OpenClaw instance.
 * Removes any existing container with the same name first.
 * Bind-mounts a persistent host directory for OpenClaw state (tied to telegramId, not instanceId).
 * Container name uses telegramId so it stays consistent across delete/recreate.
 */
export async function createInstance(config: InstanceConfig): Promise<string> {
  // Ensure image exists (build if needed)
  await ensureImageReady();

  // Use telegramId for container name - stays consistent across delete/recreate
  const name = `${CONTAINER_PREFIX}${config.telegramOwnerId}`;
  // Use telegramId-based data dir so wallet and data persist across instance recreation
  const dataDir = getUserDataDir(config.telegramOwnerId);

  // Remove existing container with same name if it exists
  try {
    const existing = docker.getContainer(name);
    await existing.stop().catch(() => {});
    await existing.remove({ force: true });
    console.log(`[docker] Removed existing container ${name}`);
  } catch {
    // Container doesn't exist, that's fine
  }

  console.log(`[docker] Creating container ${name} (image: ${IMAGE_NAME})`);

  // Build env vars — always include Telegram + OpenRouter (may be empty for OpenAI-only)
  const envVars = [
    `TELEGRAM_OWNER_ID=${config.telegramOwnerId}`,
    `TELEGRAM_BOT_TOKEN=${config.telegramBotToken}`,
    `OPENROUTER_API_KEY=${config.openrouterApiKey}`,
    `OPENCLAW_MODEL=${config.model}`,
    `LLM_PROVIDER=${config.llmProvider || "openrouter"}`,
  ];

  // Add OpenAI Codex tokens if present
  if (config.openaiAccessToken) {
    envVars.push(`OPENAI_ACCESS_TOKEN=${config.openaiAccessToken}`);
  }
  if (config.openaiRefreshToken) {
    envVars.push(`OPENAI_REFRESH_TOKEN=${config.openaiRefreshToken}`);
  }
  if (config.openaiAccountId) {
    envVars.push(`OPENAI_ACCOUNT_ID=${config.openaiAccountId}`);
  }

  const container = await docker.createContainer({
    Image: IMAGE_NAME,
    name,
    // Run as root so entrypoint can chown the bind-mount, then drop to openclaw via gosu
    User: "root",
    Env: envVars,
    HostConfig: {
      Binds: [
        // Persist all OpenClaw state (config, sessions, workspace, credentials)
        `${dataDir}:/home/openclaw/.openclaw`,
      ],
      // Use public DNS servers to avoid resolution issues with some subdomains
      Dns: ["8.8.8.8", "1.1.1.1"],
      Memory: 650 * 1024 * 1024, // 650 MB
      NanoCpus: 500_000_000, // 0.5 CPU
      RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
    },
    Labels: {
      "pmc.managed": "true",
      "pmc.instance.id": String(config.instanceId),
    },
  });

  await container.start();
  console.log(`[docker] Container ${name} started (${container.id.slice(0, 12)})`);
  return container.id;
}

/** Stop a running container */
export async function stopInstance(containerId: string): Promise<void> {
  console.log(`[docker] Stopping container ${containerId.slice(0, 12)}`);
  await docker.getContainer(containerId).stop();
}

/** Start a stopped container */
export async function startInstance(containerId: string): Promise<void> {
  console.log(`[docker] Starting container ${containerId.slice(0, 12)}`);
  await docker.getContainer(containerId).start();
}

/** Stop and remove a container */
export async function deleteInstance(containerId: string): Promise<void> {
  console.log(`[docker] Deleting container ${containerId.slice(0, 12)}`);
  const container = docker.getContainer(containerId);
  await container.stop().catch(() => {});
  await container.remove({ force: true }).catch((err: Error & { statusCode?: number }) => {
    // Ignore 404 - container was already deleted externally
    if (err.statusCode !== 404) throw err;
  });
}

/** 
 * Clean up instance container data (NOT user data - that's persistent).
 * User data (wallet, workspace) is intentionally preserved across instance deletion.
 */
export function cleanupInstanceData(_instanceId: number): void {
  // Intentionally do nothing - user data is now stored in user-{userId} directories
  // and should persist across instance deletion/recreation.
  // The container itself is deleted but the bind-mounted data remains.
  console.log(`[docker] Instance deleted — user data preserved for future instances`);
}

/** Get the detailed status of a container */
export async function getStatus(
  containerId: string
): Promise<"running" | "stopped" | "restarting" | "error" | "pending"> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    const state = info.State;
    
    if (state.Restarting) return "restarting";
    if (state.Running) {
      // Check health status - only return "running" if healthy
      const health = state.Health;
      if (health) {
        if (health.Status === "healthy") return "running";
        if (health.Status === "unhealthy") return "error";
        // "starting" or no status yet means still initializing
        return "pending";
      }
      // No healthcheck defined, assume running
      return "running";
    }
    if (state.ExitCode !== 0) return "error";
    return "stopped";
  } catch {
    return "error";
  }
}

/** Get detailed container info including health and restart count */
export async function getDetailedStatus(containerId: string): Promise<{
  status: "running" | "stopped" | "restarting" | "error" | "pending";
  restartCount: number;
  exitCode: number | null;
  error: string | null;
  healthStatus: string | null;
}> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    const state = info.State;
    
    let status: "running" | "stopped" | "restarting" | "error" | "pending" = "stopped";
    let healthStatus: string | null = null;
    
    if (state.Restarting) {
      status = "restarting";
    } else if (state.Running) {
      // Check health status
      const health = state.Health;
      if (health) {
        healthStatus = health.Status;
        if (health.Status === "healthy") {
          status = "running";
        } else if (health.Status === "unhealthy") {
          status = "error";
        } else {
          // "starting" or undefined - still initializing
          status = "pending";
        }
      } else {
        // No healthcheck, assume running
        status = "running";
      }
    } else if (state.ExitCode !== 0) {
      status = "error";
    }
    
    return {
      status,
      restartCount: info.RestartCount || 0,
      exitCode: state.ExitCode ?? null,
      error: state.Error || null,
      healthStatus,
    };
  } catch (err) {
    return {
      status: "error",
      restartCount: 0,
      exitCode: null,
      error: err instanceof Error ? err.message : "Unknown error",
      healthStatus: null,
    };
  }
}

/**
 * Parse Docker multiplexed stream format.
 * Each frame has an 8-byte header:
 * - Byte 0: Stream type (1=stdout, 2=stderr)
 * - Bytes 1-3: Reserved (0)
 * - Bytes 4-7: Frame size (big-endian uint32)
 */
function demultiplexDockerStream(buffer: Buffer): string {
  const lines: string[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    // Need at least 8 bytes for header
    if (offset + 8 > buffer.length) {
      // Incomplete header, append remaining as raw text
      lines.push(buffer.subarray(offset).toString("utf-8"));
      break;
    }

    const streamType = buffer[offset];
    // Valid stream types: 0=stdin, 1=stdout, 2=stderr
    if (streamType > 2) {
      // Not a valid multiplexed stream, treat as raw text
      lines.push(buffer.subarray(offset).toString("utf-8"));
      break;
    }

    // Read frame size (big-endian uint32 at bytes 4-7)
    const frameSize = buffer.readUInt32BE(offset + 4);

    // Sanity check: frame size shouldn't be unreasonably large
    if (frameSize > 1024 * 1024) {
      // Likely not a valid header, treat as raw
      lines.push(buffer.subarray(offset).toString("utf-8"));
      break;
    }

    const frameStart = offset + 8;
    const frameEnd = frameStart + frameSize;

    if (frameEnd > buffer.length) {
      // Incomplete frame, take what we have
      const partial = buffer.subarray(frameStart).toString("utf-8");
      if (partial.trim()) lines.push(partial);
      break;
    }

    const content = buffer.subarray(frameStart, frameEnd).toString("utf-8");
    if (content.trim()) {
      lines.push(content);
    }

    offset = frameEnd;
  }

  return lines.join("");
}

/**
 * Force rebuild the instance image from the latest Dockerfile + config.
 * Resets the imageReady flag so next ensureImageReady() will rebuild.
 * Does NOT rebuild the base image (that rarely changes).
 */
export async function forceRebuildInstanceImage(): Promise<void> {
  console.log("[docker] Force-rebuilding instance image...");
  imageReady = false;

  // Wait for any in-progress build to finish first
  if (imageBuildPromise) {
    await imageBuildPromise.catch(() => {});
  }

  // Ensure base image exists
  await ensureBaseImage();

  // Rebuild instance image (copies latest skills, workspace, scripts)
  await buildDockerImage(IMAGE_NAME, INSTANCE_DOCKERFILE_DIR, [
    "--build-arg", `BASE_IMAGE=${BASE_IMAGE_NAME}`,
    "--no-cache",
  ]);

  imageReady = true;
  console.log("[docker] Instance image rebuilt successfully");
}

/**
 * Rolling update: rebuild image, then recreate all running pmc containers
 * one at a time. Each container is stopped, removed, and recreated from
 * the new image. User data (wallet, trades, etc.) is preserved via
 * bind mounts. The entrypoint.sh handles syncing new workspace/skill files.
 *
 * Returns a summary of what happened per container.
 */
export interface UpdateResult {
  name: string;
  instanceId?: number;
  newContainerId?: string;
  status: "updated" | "skipped" | "failed";
  error?: string;
}

export async function rollingUpdateAll(
  getInstanceConfig: (containerId: string) => Promise<InstanceConfig | null>
): Promise<UpdateResult[]> {
  const results: UpdateResult[] = [];

  // 1. Rebuild image
  await forceRebuildInstanceImage();

  // 2. Find all pmc-managed containers
  const containers = await docker.listContainers({
    all: true, // include stopped
    filters: { label: ["pmc.managed=true"] },
  });

  console.log(`[docker] Rolling update: found ${containers.length} managed container(s)`);

  // 3. Update each container one at a time
  for (const containerInfo of containers) {
    const name = containerInfo.Names?.[0]?.replace(/^\//, "") || containerInfo.Id.slice(0, 12);
    const oldId = containerInfo.Id;

    try {
      // Get the config needed to recreate this container
      const config = await getInstanceConfig(oldId);
      if (!config) {
        console.log(`[docker] Skipping ${name} — no matching instance config found`);
        results.push({ name, status: "skipped", error: "No instance config in DB" });
        continue;
      }

      console.log(`[docker] Updating ${name}...`);

      // Stop and remove old container
      const oldContainer = docker.getContainer(oldId);
      if (containerInfo.State === "running") {
        await oldContainer.stop().catch(() => {});
      }
      await oldContainer.remove({ force: true }).catch(() => {});

      // Recreate from new image (createInstance handles naming, bind mounts, etc.)
      const newContainerId = await createInstance(config);

      console.log(`[docker] Updated ${name} successfully (new: ${newContainerId.slice(0, 12)})`);
      results.push({ name, instanceId: config.instanceId, newContainerId, status: "updated" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[docker] Failed to update ${name}: ${msg}`);
      results.push({ name, status: "failed", error: msg });
    }
  }

  return results;
}

/** Restart a running container */
export async function restartInstance(containerId: string): Promise<void> {
  console.log(`[docker] Restarting container ${containerId.slice(0, 12)}`);
  await docker.getContainer(containerId).restart();
}

/** List all pmc-managed containers with detailed info */
export async function listManagedContainers(): Promise<
  Array<{
    id: string;
    name: string;
    state: string;
    status: string;
    created: number;
    image: string;
    labels: Record<string, string>;
  }>
> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ["pmc.managed=true"] },
  });

  return containers.map((c) => ({
    id: c.Id,
    name: c.Names?.[0]?.replace(/^\//, "") || c.Id.slice(0, 12),
    state: c.State,
    status: c.Status,
    created: c.Created,
    image: c.Image,
    labels: c.Labels || {},
  }));
}

/** Get container resource usage stats (CPU, memory, network) */
export async function getContainerStats(containerId: string): Promise<{
  cpuPercent: number;
  memoryUsageMB: number;
  memoryLimitMB: number;
  memoryPercent: number;
  networkRxMB: number;
  networkTxMB: number;
  pids: number;
}> {
  const container = docker.getContainer(containerId);
  const stats = await container.stats({ stream: false }) as any;

  // CPU calculation
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage -
    stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const numCpus = stats.cpu_stats.online_cpus || 1;
  const cpuPercent =
    systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

  // Memory
  const memUsage = stats.memory_stats.usage || 0;
  const memLimit = stats.memory_stats.limit || 1;

  // Network (sum all interfaces)
  let netRx = 0;
  let netTx = 0;
  if (stats.networks) {
    for (const iface of Object.values(stats.networks) as any[]) {
      netRx += iface.rx_bytes || 0;
      netTx += iface.tx_bytes || 0;
    }
  }

  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryUsageMB: Math.round((memUsage / 1024 / 1024) * 100) / 100,
    memoryLimitMB: Math.round((memLimit / 1024 / 1024) * 100) / 100,
    memoryPercent: Math.round((memUsage / memLimit) * 10000) / 100,
    networkRxMB: Math.round((netRx / 1024 / 1024) * 100) / 100,
    networkTxMB: Math.round((netTx / 1024 / 1024) * 100) / 100,
    pids: stats.pids_stats?.current || 0,
  };
}

/** Get Docker host system info */
export async function getDockerInfo(): Promise<{
  containers: number;
  containersRunning: number;
  containersStopped: number;
  images: number;
  serverVersion: string;
  memoryTotalGB: number;
  cpus: number;
  operatingSystem: string;
}> {
  const info = await docker.info() as any;
  return {
    containers: info.Containers ?? 0,
    containersRunning: info.ContainersRunning ?? 0,
    containersStopped: info.ContainersStopped ?? 0,
    images: info.Images ?? 0,
    serverVersion: info.ServerVersion ?? "unknown",
    memoryTotalGB:
      Math.round(((info.MemTotal ?? 0) / 1024 / 1024 / 1024) * 100) / 100,
    cpus: info.NCPU ?? 0,
    operatingSystem: info.OperatingSystem ?? "unknown",
  };
}

/** Get the last N lines of container logs */
export async function getLogs(
  containerId: string,
  tail = 100
): Promise<string> {
  try {
    const buffer = (await docker.getContainer(containerId).logs({
      stdout: true,
      stderr: true,
      tail,
    })) as Buffer;

    return demultiplexDockerStream(buffer);
  } catch (err) {
    const dockerErr = err as Error & { statusCode?: number };
    if (dockerErr.statusCode === 404) {
      return "[Container not found - it may have been deleted]";
    }
    throw err;
  }
}

/**
 * Stream container logs in real time.
 * Returns a cleanup function to stop the stream.
 */
export async function streamLogs(
  containerId: string,
  onLog: (line: string) => void,
  onError: (err: Error) => void,
  onEnd: () => void
): Promise<() => void> {
  const container = docker.getContainer(containerId);

  const stream = await container.logs({
    stdout: true,
    stderr: true,
    follow: true,
    tail: 50,
  });

  // Buffer for accumulating partial frames
  let pending = Buffer.alloc(0);

  stream.on("data", (chunk: Buffer) => {
    // Accumulate chunks
    pending = Buffer.concat([pending, chunk]);

    // Process complete frames
    while (pending.length >= 8) {
      const streamType = pending[0];
      if (streamType > 2) {
        // Not multiplexed, emit as-is and clear
        const text = pending.toString("utf-8");
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (trimmed) onLog(trimmed);
        }
        pending = Buffer.alloc(0);
        break;
      }

      const frameSize = pending.readUInt32BE(4);
      const totalFrameLen = 8 + frameSize;

      if (pending.length < totalFrameLen) {
        // Wait for more data
        break;
      }

      const content = pending.subarray(8, totalFrameLen).toString("utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) onLog(trimmed);
      }

      pending = pending.subarray(totalFrameLen);
    }
  });

  stream.on("error", onError);
  stream.on("end", onEnd);

  return () => {
    (stream as any).destroy();
  };
}
