import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { instances, users, subscriptions, type Instance } from "../db/schema";
import * as docker from "../services/docker";
import { encrypt, decrypt } from "../services/crypto";
import { instanceCreationRateLimit } from "../middleware/rate-limit";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { completedTokens } from "./openai-auth";

type Variables = { userId: number };
const instanceRoutes = new Hono<{ Variables: Variables }>();

const DEFAULT_MODEL = "openrouter/moonshotai/kimi-k2.5";

/**
 * Build a Docker InstanceConfig from a DB instance record + user.
 * Decrypts all encrypted secrets. Used by create, start, and update flows.
 */
function buildDockerConfig(
  instance: Instance,
  user: { id: number; telegramId: string },
  overrides?: { telegramBotToken?: string; openrouterApiKey?: string; model?: string }
): docker.InstanceConfig {
  const telegramBotToken =
    overrides?.telegramBotToken || decrypt(instance.telegramBotToken);
  const openrouterApiKey =
    overrides?.openrouterApiKey || decrypt(instance.openrouterApiKey);
  const model = overrides?.model || instance.model || DEFAULT_MODEL;

  const config: docker.InstanceConfig = {
    instanceId: instance.id,
    userId: user.id,
    telegramOwnerId: user.telegramId,
    telegramBotToken,
    openrouterApiKey,
    model,
    llmProvider: instance.llmProvider || "openrouter",
  };

  // Add OpenAI tokens if using Codex provider
  if (instance.llmProvider === "openai-codex" && instance.openaiAccessToken) {
    config.openaiAccessToken = decrypt(instance.openaiAccessToken);
    if (instance.openaiRefreshToken) {
      config.openaiRefreshToken = decrypt(instance.openaiRefreshToken);
    }
    config.openaiAccountId = instance.openaiAccountId || undefined;
  }

  return config;
}

/**
 * Safely parse a string to an integer.
 * Returns null if the value is not a valid integer.
 */
function safeParseInt(value: string): number | null {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

const createSchema = z.object({
  telegramBotToken: z.string().min(1),
  telegramBotUsername: z.string().min(1).optional(),
  openrouterApiKey: z.string().default(""),
  model: z.string().min(1).optional(),
  llmProvider: z.enum(["openrouter", "openai-codex"]).default("openrouter"),
});

const updateSchema = z.object({
  openrouterApiKey: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

// ── List instances ─────────────────────────────────────────────────
instanceRoutes.get("/", async (c) => {
  const userId = c.get("userId");

  const rows = await db.query.instances.findMany({
    where: eq(instances.userId, userId),
  });

  const result = await Promise.all(
    rows.map(async (inst) => ({
      id: inst.id,
      status: inst.containerId
        ? await docker.getStatus(inst.containerId)
        : inst.status,
      botUsername: inst.telegramBotUsername,
      model: inst.model,
      createdAt: inst.createdAt,
      startedAt: inst.startedAt,
    }))
  );

  return c.json({ instances: result });
});

// ── Create instance ────────────────────────────────────────────────
instanceRoutes.post("/", instanceCreationRateLimit, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request data" }, 400);
  }

  // One instance per user
  const existing = await db.query.instances.findFirst({
    where: eq(instances.userId, userId),
  });
  if (existing) {
    return c.json({ error: "You already have an instance" }, 400);
  }

  // Require active subscription
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, "active")
    ),
  });
  if (!subscription) {
    return c.json(
      { error: "Active subscription required. Subscribe first at /pricing." },
      403
    );
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const llmProvider = parsed.data.llmProvider;
  const model = parsed.data.model || (llmProvider === "openai-codex" ? "openai-codex/o4-mini" : DEFAULT_MODEL);

  // Validate provider-specific requirements
  if (llmProvider === "openrouter" && !parsed.data.openrouterApiKey) {
    return c.json({ error: "OpenRouter API key is required" }, 400);
  }

  // For OpenAI Codex, retrieve tokens from the completed device code flow
  let openaiTokens: { accessToken: string; refreshToken?: string; accountId: string | null; expiresAt: number } | undefined;
  if (llmProvider === "openai-codex") {
    openaiTokens = completedTokens.get(userId);
    if (!openaiTokens) {
      return c.json({ error: "OpenAI authentication required. Please connect your OpenAI account first." }, 400);
    }
    completedTokens.delete(userId); // Consume the tokens
  }

  // Encrypt sensitive data before storing
  const encryptedTelegramBotToken = encrypt(parsed.data.telegramBotToken);
  const encryptedOpenrouterApiKey = encrypt(parsed.data.openrouterApiKey || "");

  // Insert DB row first (with encrypted secrets)
  const [instance] = await db
    .insert(instances)
    .values({
      userId,
      telegramBotToken: encryptedTelegramBotToken,
      telegramBotUsername: parsed.data.telegramBotUsername,
      openrouterApiKey: encryptedOpenrouterApiKey,
      bankrApiKey: "", // No longer used - self-managed wallet
      model,
      status: "pending",
      llmProvider,
      ...(openaiTokens && {
        openaiAccessToken: encrypt(openaiTokens.accessToken),
        openaiRefreshToken: openaiTokens.refreshToken ? encrypt(openaiTokens.refreshToken) : null,
        openaiAccountId: openaiTokens.accountId,
        openaiTokenExpires: openaiTokens.expiresAt,
      }),
    })
    .returning();

  // Create Docker container (with plaintext secrets for env vars)
  try {
    const containerId = await docker.createInstance(
      buildDockerConfig(instance, user, {
        telegramBotToken: parsed.data.telegramBotToken,
        openrouterApiKey: parsed.data.openrouterApiKey,
        model,
      })
    );

    await db
      .update(instances)
      .set({ containerId, status: "pending", startedAt: new Date() })
      .where(eq(instances.id, instance.id));

    return c.json({
      instance: {
        id: instance.id,
        status: "pending",
        botUsername: parsed.data.telegramBotUsername,
        model,
      },
    });
  } catch (err) {
    await db
      .update(instances)
      .set({ status: "error" })
      .where(eq(instances.id, instance.id));
    console.error("Failed to create Docker container:", err);
    return c.json({ error: "Failed to start instance" }, 500);
  }
});

// ── Stop instance ──────────────────────────────────────────────────
instanceRoutes.post("/:id/stop", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance?.containerId) {
    return c.json({ error: "Instance not found" }, 404);
  }

  try {
    await docker.stopInstance(instance.containerId);
  } catch (err) {
    console.error("Failed to stop Docker container:", err);
    return c.json({ error: "Failed to stop instance" }, 500);
  }

  await db
    .update(instances)
    .set({ status: "stopped", stoppedAt: new Date() })
    .where(eq(instances.id, id));

  return c.json({ status: "stopped" });
});

// ── Start instance ─────────────────────────────────────────────────
instanceRoutes.post("/:id/start", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  // Require active subscription to start an instance
  const subscription = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, "active")
    ),
  });
  if (!subscription) {
    return c.json(
      { error: "Active subscription required. Subscribe first at /pricing." },
      403
    );
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  // Get user for telegramId (needed for container recreation)
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  try {
    // Try to start existing container first
    if (instance.containerId) {
      try {
        await docker.startInstance(instance.containerId);
      } catch (startErr: unknown) {
        // If container doesn't exist (404), recreate it
        const isNotFound = startErr instanceof Error && 
          'statusCode' in startErr && 
          (startErr as { statusCode: number }).statusCode === 404;
        
        if (isNotFound) {
          console.log(`[start] Container ${instance.containerId.slice(0, 12)} not found, recreating...`);
          
          // Recreate the container with all credentials
          const containerId = await docker.createInstance(
            buildDockerConfig(instance, user)
          );
          
          // Update DB with new container ID
          await db
            .update(instances)
            .set({ containerId, status: "pending", startedAt: new Date() })
            .where(eq(instances.id, id));
          
          return c.json({ status: "pending" });
        }
        
        // Re-throw if it's not a 404
        throw startErr;
      }
    } else {
      // No container ID stored, create new container
      console.log(`[start] No container ID for instance ${id}, creating new container...`);
      
      const containerId = await docker.createInstance(
        buildDockerConfig(instance, user)
      );
      
      await db
        .update(instances)
        .set({ containerId, status: "pending", startedAt: new Date() })
        .where(eq(instances.id, id));
      
      return c.json({ status: "pending" });
    }
  } catch (err) {
    console.error("Failed to start Docker container:", err);
    return c.json({ error: "Failed to start instance" }, 500);
  }

  await db
    .update(instances)
    .set({ status: "pending", startedAt: new Date() })
    .where(eq(instances.id, id));

  return c.json({ status: "pending" });
});

// ── Get instance status (real-time from Docker) ────────────────────
instanceRoutes.get("/:id/status", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  if (!instance.containerId) {
    return c.json({
      status: instance.status,
      restartCount: 0,
      exitCode: null,
      error: null,
      healthy: false,
    });
  }

  const detailed = await docker.getDetailedStatus(instance.containerId);
  
  // Update DB status if it changed
  if (detailed.status !== instance.status) {
    await db
      .update(instances)
      .set({ status: detailed.status })
      .where(eq(instances.id, id));
  }

  return c.json({
    status: detailed.status,
    restartCount: detailed.restartCount,
    exitCode: detailed.exitCode,
    error: detailed.error,
    healthStatus: detailed.healthStatus,
    healthy: detailed.status === "running" && detailed.restartCount === 0,
  });
});

// ── Update instance settings ───────────────────────────────────────
instanceRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }
  const body = await c.req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request data" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  // Build update object - encrypt new secrets
  const updates: Record<string, string> = {};
  const plaintextUpdates: Record<string, string> = {}; // For Docker env vars

  if (parsed.data.openrouterApiKey) {
    updates.openrouterApiKey = encrypt(parsed.data.openrouterApiKey);
    plaintextUpdates.openrouterApiKey = parsed.data.openrouterApiKey;
  }
  if (parsed.data.model) {
    updates.model = parsed.data.model;
    plaintextUpdates.model = parsed.data.model;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No updates provided" }, 400);
  }

  await db.update(instances).set(updates).where(eq(instances.id, id));

  // If container exists, recreate it with new settings
  if (instance.containerId) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const updated = await db.query.instances.findFirst({
      where: eq(instances.id, id),
    });
    if (!updated) {
      return c.json({ error: "Instance not found after update" }, 404);
    }

    try {
      await docker.deleteInstance(instance.containerId);

      // Recreate with all credentials (including OpenAI tokens if set)
      const containerId = await docker.createInstance(
        buildDockerConfig(updated, user)
      );

      await db
        .update(instances)
        .set({ containerId, status: "pending", startedAt: new Date() })
        .where(eq(instances.id, id));

      return c.json({ status: "updated", restarted: true });
    } catch (err) {
      console.error("Failed to recreate container:", err);
      await db
        .update(instances)
        .set({ status: "error" })
        .where(eq(instances.id, id));
      return c.json({ error: "Failed to restart instance" }, 500);
    }
  }

  return c.json({ status: "updated", restarted: false });
});

// ── Delete instance ────────────────────────────────────────────────
instanceRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  if (instance.containerId) {
    await docker.deleteInstance(instance.containerId);
  }
  
  // Clean up host-side data directory
  docker.cleanupInstanceData(id);
  
  await db.delete(instances).where(eq(instances.id, id));

  return c.json({ deleted: true });
});

// ── Get logs (snapshot) ────────────────────────────────────────────
instanceRoutes.get("/:id/logs", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance?.containerId) {
    return c.json({ error: "Instance not found" }, 404);
  }

  const logs = await docker.getLogs(instance.containerId);
  return c.json({ logs });
});

// ── Stream logs (SSE) ──────────────────────────────────────────────
instanceRoutes.get("/:id/logs/stream", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance?.containerId) {
    return c.json({ error: "Instance not found" }, 404);
  }

  const containerId = instance.containerId;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let cleanup: (() => void) | null = null;
      let aborted = false;

      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Controller may be closed
        }
      };

      // Set up abort handler first to handle early disconnects
      c.req.raw.signal.addEventListener("abort", () => {
        aborted = true;
        if (cleanup) cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });

      // Don't start streaming if already aborted
      if (aborted) return;

      try {
        cleanup = await docker.streamLogs(
          containerId,
          (line) => send({ log: line }),
          (err) => {
            send({ error: err.message });
            try { controller.close(); } catch { /* already closed */ }
          },
          () => {
            send({ done: true });
            try { controller.close(); } catch { /* already closed */ }
          }
        );
      } catch {
        send({ error: "Failed to start log stream" });
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable buffering for reverse proxies (nginx, cloudflare, etc.)
      "X-Accel-Buffering": "no",
    },
  });
});

// ── Get wallet info ─────────────────────────────────────────────────
const INSTANCES_DATA_DIR = process.env.INSTANCES_DATA_DIR || "./data/instances";

instanceRoutes.get("/:id/wallet", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  // Get user's telegramId for the data directory path
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Read wallet from user's data directory (uses telegramId, not database id)
  const walletPath = resolve(INSTANCES_DATA_DIR, `user-${user.telegramId}`, ".wallet.json");
  
  if (!existsSync(walletPath)) {
    return c.json({ 
      address: null, 
      message: "Wallet not yet created. Start your bot to generate a wallet." 
    });
  }

  try {
    const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
    return c.json({
      address: walletData.publicKey,
      // Don't expose private key!
    });
  } catch (err) {
    console.error("Failed to read wallet:", err);
    return c.json({ error: "Failed to read wallet data" }, 500);
  }
});

// ── Get wallet balance ──────────────────────────────────────────────
instanceRoutes.get("/:id/wallet/balance", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  // Get user's telegramId for the data directory path
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Read wallet address (uses telegramId, not database id)
  const walletPath = resolve(INSTANCES_DATA_DIR, `user-${user.telegramId}`, ".wallet.json");
  
  if (!existsSync(walletPath)) {
    return c.json({ error: "Wallet not yet created" }, 404);
  }

  let address: string;
  try {
    const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
    address = walletData.publicKey;
  } catch {
    return c.json({ error: "Failed to read wallet data" }, 500);
  }

  // Fetch balance from Solana RPC
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });

    const data = await response.json() as { result?: { value?: number }, error?: { message?: string } };
    
    if (data.error) {
      return c.json({ error: data.error.message || "RPC error" }, 500);
    }

    const lamports = data.result?.value || 0;
    const sol = lamports / 1_000_000_000;

    return c.json({
      address,
      lamports,
      sol,
      formatted: sol.toFixed(4) + " SOL",
    });
  } catch (err) {
    console.error("Failed to fetch balance:", err);
    return c.json({ error: "Failed to fetch balance" }, 500);
  }
});

// ── Get wallet token holdings ───────────────────────────────────────
instanceRoutes.get("/:id/wallet/tokens", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  // Get user's telegramId for the data directory path
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Read wallet address
  const walletPath = resolve(INSTANCES_DATA_DIR, `user-${user.telegramId}`, ".wallet.json");
  
  if (!existsSync(walletPath)) {
    return c.json({ error: "Wallet not yet created" }, 404);
  }

  let address: string;
  try {
    const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
    address = walletData.publicKey;
  } catch {
    return c.json({ error: "Failed to read wallet data" }, 500);
  }

  // Fetch token accounts from Solana RPC
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          address,
          { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
          { encoding: "jsonParsed" }
        ],
      }),
    });

    const data = await response.json() as { 
      result?: { value?: Array<{
        pubkey: string;
        account: {
          data: {
            parsed: {
              info: {
                mint: string;
                tokenAmount: {
                  amount: string;
                  decimals: number;
                  uiAmount: number;
                  uiAmountString: string;
                };
              };
            };
          };
        };
      }> };
      error?: { message?: string };
    };
    
    if (data.error) {
      return c.json({ error: data.error.message || "RPC error" }, 500);
    }

    const tokens = (data.result?.value || [])
      .map((account) => {
        const info = account.account.data.parsed.info;
        return {
          mint: info.mint,
          balance: info.tokenAmount.uiAmountString,
          decimals: info.tokenAmount.decimals,
          rawAmount: info.tokenAmount.amount,
        };
      })
      .filter((t) => parseFloat(t.balance) > 0); // Only tokens with balance

    return c.json({
      address,
      tokens,
      count: tokens.length,
    });
  } catch (err) {
    console.error("Failed to fetch token accounts:", err);
    return c.json({ error: "Failed to fetch token holdings" }, 500);
  }
});

// ── Get wallet transaction history ──────────────────────────────────
instanceRoutes.get("/:id/wallet/transactions", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  // Get user's telegramId for the data directory path
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Read wallet address
  const walletPath = resolve(INSTANCES_DATA_DIR, `user-${user.telegramId}`, ".wallet.json");
  
  if (!existsSync(walletPath)) {
    return c.json({ error: "Wallet not yet created" }, 404);
  }

  let address: string;
  try {
    const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
    address = walletData.publicKey;
  } catch {
    return c.json({ error: "Failed to read wallet data" }, 500);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  
  try {
    // Get recent signatures
    const sigResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [address, { limit }],
      }),
    });

    const sigData = await sigResponse.json() as {
      result?: Array<{
        signature: string;
        slot: number;
        blockTime: number | null;
        err: unknown;
        memo: string | null;
      }>;
      error?: { message?: string };
    };

    if (sigData.error) {
      return c.json({ error: sigData.error.message || "RPC error" }, 500);
    }

    const signatures = sigData.result || [];
    
    if (signatures.length === 0) {
      return c.json({ address, transactions: [], count: 0 });
    }

    // Get transaction details for each signature
    const txPromises = signatures.slice(0, 10).map(async (sig) => {
      try {
        const txResponse = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTransaction",
            params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
          }),
        });
        
        const txData = await txResponse.json() as { result?: unknown };
        return { signature: sig.signature, blockTime: sig.blockTime, tx: txData.result };
      } catch {
        return { signature: sig.signature, blockTime: sig.blockTime, tx: null };
      }
    });

    const txResults = await Promise.all(txPromises);

    // Parse transactions to extract swap/trade info
    const transactions = txResults.map((result) => {
      const tx = result.tx as {
        meta?: {
          preBalances?: number[];
          postBalances?: number[];
          preTokenBalances?: Array<{
            mint: string;
            uiTokenAmount: { uiAmount: number; uiAmountString: string };
            owner: string;
          }>;
          postTokenBalances?: Array<{
            mint: string;
            uiTokenAmount: { uiAmount: number; uiAmountString: string };
            owner: string;
          }>;
          err: unknown;
        };
        transaction?: {
          message?: {
            instructions?: Array<{
              programId?: string;
              program?: string;
              parsed?: {
                type?: string;
                info?: {
                  source?: string;
                  destination?: string;
                  lamports?: number;
                  amount?: string;
                  mint?: string;
                };
              };
            }>;
          };
        };
      } | null;

      if (!tx || !tx.meta) {
        return {
          signature: result.signature,
          blockTime: result.blockTime,
          type: "unknown",
          success: true,
        };
      }

      const success = !tx.meta.err;
      
      // Calculate SOL change
      const preSOL = (tx.meta.preBalances?.[0] || 0) / 1_000_000_000;
      const postSOL = (tx.meta.postBalances?.[0] || 0) / 1_000_000_000;
      const solChange = postSOL - preSOL;

      // Calculate token changes for this wallet
      const preTokens = tx.meta.preTokenBalances?.filter(t => t.owner === address) || [];
      const postTokens = tx.meta.postTokenBalances?.filter(t => t.owner === address) || [];
      
      const tokenChanges: Array<{ mint: string; change: number; symbol?: string }> = [];
      
      // Find tokens that changed
      const allMints = new Set([
        ...preTokens.map(t => t.mint),
        ...postTokens.map(t => t.mint)
      ]);

      for (const mint of allMints) {
        const pre = preTokens.find(t => t.mint === mint)?.uiTokenAmount.uiAmount || 0;
        const post = postTokens.find(t => t.mint === mint)?.uiTokenAmount.uiAmount || 0;
        const change = post - pre;
        if (Math.abs(change) > 0.000001) {
          tokenChanges.push({ mint, change });
        }
      }

      // Determine transaction type
      let type = "transfer";
      if (tokenChanges.length > 0 && Math.abs(solChange) > 0.0001) {
        // SOL went down, tokens went up = BUY
        // SOL went up, tokens went down = SELL
        if (solChange < -0.001 && tokenChanges.some(t => t.change > 0)) {
          type = "buy";
        } else if (solChange > 0.001 && tokenChanges.some(t => t.change < 0)) {
          type = "sell";
        } else {
          type = "swap";
        }
      } else if (Math.abs(solChange) > 0.0001 && tokenChanges.length === 0) {
        type = solChange > 0 ? "receive" : "send";
      }

      return {
        signature: result.signature,
        blockTime: result.blockTime,
        type,
        success,
        solChange: solChange !== 0 ? solChange.toFixed(6) : null,
        tokenChanges: tokenChanges.length > 0 ? tokenChanges.map(t => ({
          mint: t.mint,
          change: t.change.toFixed(6),
        })) : null,
      };
    });

    return c.json({
      address,
      transactions,
      count: transactions.length,
    });
  } catch (err) {
    console.error("Failed to fetch transactions:", err);
    return c.json({ error: "Failed to fetch transaction history" }, 500);
  }
});

export default instanceRoutes;
