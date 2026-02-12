import { Hono } from "hono";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { instances, users, subscriptions, type Instance } from "../db/schema";
import * as docker from "../services/docker";
import { encrypt, decrypt } from "../services/crypto";
import { instanceCreationRateLimit } from "../middleware/rate-limit";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createPrivateKey, sign as cryptoSign } from "crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { completedTokens } from "./openai-auth";

type Variables = { userId: number };
const instanceRoutes = new Hono<{ Variables: Variables }>();

const DEFAULT_MODEL = "openrouter/moonshotai/kimi-k2.5";

// ── DexScreener API helper ──────────────────────────────────────────
// Free API, no key needed. Rate limit: 300 req/min for token endpoints.
// GET /tokens/v1/solana/{addresses} — up to 30 comma-separated addresses
type DexScreenerPair = {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string | null; name: string | null; symbol: string | null };
  priceNative: string;
  priceUsd: string | null;
  volume: Record<string, number>;
  priceChange: Record<string, number> | null;
  liquidity: { usd: number | null; base: number; quote: number } | null;
  fdv: number | null;
  marketCap: number | null;
  pairCreatedAt: number | null;
  info: {
    imageUrl: string | null;
    websites: Array<{ url: string }> | null;
    socials: Array<{ platform: string; handle: string }> | null;
  } | null;
};

// Simple in-memory cache for DexScreener lookups (TTL: 60s)
const dexCache = new Map<string, { data: DexScreenerPair | null; ts: number }>();
const DEX_CACHE_TTL = 60_000;

async function fetchDexScreenerTokens(mints: string[]): Promise<Map<string, DexScreenerPair>> {
  const result = new Map<string, DexScreenerPair>();
  if (mints.length === 0) return result;

  // Check cache first, collect uncached mints
  const uncachedMints: string[] = [];
  const now = Date.now();
  for (const mint of mints) {
    const cached = dexCache.get(mint);
    if (cached && now - cached.ts < DEX_CACHE_TTL) {
      if (cached.data) result.set(mint, cached.data);
    } else {
      uncachedMints.push(mint);
    }
  }

  if (uncachedMints.length === 0) return result;

  // Batch in groups of 30 (DexScreener limit)
  for (let i = 0; i < uncachedMints.length; i += 30) {
    const batch = uncachedMints.slice(i, i + 30);
    const url = `https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`;
    try {
      const resp = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) continue;
      const pairs = (await resp.json()) as DexScreenerPair[];
      if (!Array.isArray(pairs)) continue;

      // Index by base token address; prefer pumpfun dex, then highest liquidity
      const byMint = new Map<string, DexScreenerPair>();
      for (const pair of pairs) {
        const addr = pair.baseToken?.address;
        if (!addr) continue;
        const existing = byMint.get(addr);
        if (!existing ||
          (pair.dexId === "pumpfun" && existing.dexId !== "pumpfun") ||
          (pair.dexId === existing.dexId &&
            (pair.liquidity?.usd ?? 0) > (existing.liquidity?.usd ?? 0))) {
          byMint.set(addr, pair);
        }
      }

      for (const mint of batch) {
        const pair = byMint.get(mint) || null;
        dexCache.set(mint, { data: pair, ts: now });
        if (pair) result.set(mint, pair);
      }
    } catch (err) {
      console.error("[dexscreener] Batch fetch failed:", err);
      // Cache misses as null so we don't retry immediately
      for (const mint of batch) {
        if (!dexCache.has(mint)) {
          dexCache.set(mint, { data: null, ts: now });
        }
      }
    }
  }

  return result;
}

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
    config.openaiTokenExpires = instance.openaiTokenExpires || undefined;
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
  const model = parsed.data.model || (llmProvider === "openai-codex" ? "openai-codex/gpt-5.3-codex" : DEFAULT_MODEL);

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

// Helper to read TRADES.json from the instance's data directory
type TradesData = {
  trades: Array<{
    timestamp: string;
    action: string;
    mint: string;
    solAmount: number;
    tokenAmount: number | null;
    profitSOL?: number;
  }>;
  buyCountByMint: Record<string, number>;
  totalProfitSOL: number;
  positions: Record<string, {
    totalCostSOL: number;
    totalTokens: number;
    buyCount: number;
    boughtAt: string | null;
    firstBoughtAt?: string | null;
  }>;
  dailyPL?: Record<string, {
    profit: number;
    trades: number;
    wins: number;
    losses: number;
  }>;
};

function readTradesJson(telegramId: string): TradesData | null {
  const tradesPath = resolve(INSTANCES_DATA_DIR, `user-${telegramId}`, "workspace", "TRADES.json");
  try {
    if (!existsSync(tradesPath)) return null;
    const data = JSON.parse(readFileSync(tradesPath, "utf-8"));
    return data as TradesData;
  } catch {
    return null;
  }
}

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

// ── Solana RPC proxy: getLatestBlockhash ────────────────────────────
// The public Solana RPC blocks browser requests (403). This endpoint
// proxies the call server-side so the frontend can build transactions.
instanceRoutes.get("/solana/blockhash", async (c) => {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getLatestBlockhash",
        params: [{ commitment: "confirmed" }],
      }),
    });

    const data = await response.json() as {
      result?: { value?: { blockhash?: string; lastValidBlockHeight?: number } };
      error?: { message?: string };
    };

    if (data.error) {
      return c.json({ error: data.error.message || "RPC error" }, 502);
    }

    const blockhash = data.result?.value?.blockhash;
    const lastValidBlockHeight = data.result?.value?.lastValidBlockHeight;

    if (!blockhash) {
      return c.json({ error: "No blockhash in RPC response" }, 502);
    }

    return c.json({ blockhash, lastValidBlockHeight });
  } catch (err) {
    console.error("Failed to fetch blockhash:", err);
    return c.json({ error: "Failed to fetch blockhash from Solana RPC" }, 502);
  }
});

// ── Solana RPC proxy: sendRawTransaction ────────────────────────────
// Submits a signed transaction to the Solana network via the backend RPC.
instanceRoutes.post("/solana/send-transaction", async (c) => {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  try {
    const body = await c.req.json() as { transaction: string };
    if (!body.transaction) {
      return c.json({ error: "Missing transaction" }, 400);
    }

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [body.transaction, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }],
      }),
    });

    const data = await response.json() as {
      result?: string;
      error?: { message?: string; code?: number; data?: unknown };
    };

    if (data.error) {
      return c.json({ error: data.error.message || "RPC error", details: data.error }, 502);
    }

    return c.json({ signature: data.result });
  } catch (err) {
    console.error("Failed to send transaction:", err);
    return c.json({ error: "Failed to send transaction" }, 502);
  }
});

// ── Solana RPC proxy: confirmTransaction ────────────────────────────
instanceRoutes.post("/solana/confirm-transaction", async (c) => {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  try {
    const body = await c.req.json() as { signature: string };
    if (!body.signature) {
      return c.json({ error: "Missing signature" }, 400);
    }

    // Poll getSignatureStatuses until confirmed or timeout
    const startTime = Date.now();
    const TIMEOUT = 60_000;

    while (Date.now() - startTime < TIMEOUT) {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getSignatureStatuses",
          params: [[body.signature], { searchTransactionHistory: false }],
        }),
      });

      const data = await response.json() as {
        result?: { value?: Array<{ confirmationStatus?: string; err?: unknown } | null> };
        error?: { message?: string };
      };

      if (data.error) {
        return c.json({ error: data.error.message || "RPC error" }, 502);
      }

      const status = data.result?.value?.[0];
      if (status) {
        if (status.err) {
          return c.json({ confirmed: false, error: "Transaction failed on-chain" }, 200);
        }
        if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
          return c.json({ confirmed: true, status: status.confirmationStatus });
        }
      }

      // Wait 2s before polling again
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return c.json({ confirmed: false, error: "Confirmation timeout" }, 200);
  } catch (err) {
    console.error("Failed to confirm transaction:", err);
    return c.json({ error: "Failed to confirm transaction" }, 502);
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

  // Fetch token accounts from both Token Program and Token-2022 Program
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  type TokenAccountResult = {
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
                uiAmount: number | null;
                uiAmountString: string;
              };
            };
          };
        };
      };
    }> };
    error?: { message?: string };
  };
  
  try {
    // Query both token programs in parallel (with 8s timeout to avoid hanging)
    const rpcFetchOptions = (programId: string, id: number) => ({
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id,
        method: "getTokenAccountsByOwner",
        params: [address, { programId }, { encoding: "jsonParsed" }],
      }),
      signal: AbortSignal.timeout(8000),
    });

    const [response1, response2] = await Promise.all([
      fetch(rpcUrl, rpcFetchOptions(TOKEN_PROGRAM, 1)),
      fetch(rpcUrl, rpcFetchOptions(TOKEN_2022_PROGRAM, 2)),
    ]);

    const [data1, data2] = await Promise.all([
      response1.json() as Promise<TokenAccountResult>,
      response2.json() as Promise<TokenAccountResult>,
    ]);
    
    if (data1.error && data2.error) {
      return c.json({ error: data1.error.message || "RPC error" }, 500);
    }

    const allAccounts = [
      ...(data1.result?.value || []),
      ...(data2.result?.value || []),
    ];

    const rawTokens = allAccounts
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

    // Enrich with DexScreener data (name, symbol, price, image, etc.)
    const mints = rawTokens.map((t) => t.mint);
    const dexData = await fetchDexScreenerTokens(mints);

    // Read TRADES.json for cost basis / P&L
    const tradesData = readTradesJson(user.telegramId);
    const positions = tradesData?.positions ?? {};

    const tokens = rawTokens.map((t) => {
      const pair = dexData.get(t.mint);
      const priceUsd = pair?.priceUsd ? parseFloat(pair.priceUsd) : null;
      const priceNative = pair?.priceNative ? parseFloat(pair.priceNative) : null;
      const balanceNum = parseFloat(t.balance);
      const valueUsd = priceUsd && balanceNum ? priceUsd * balanceNum : null;

      // Cost basis from TRADES.json
      const pos = positions[t.mint];
      const costBasisSOL = pos?.totalCostSOL ?? null;
      const currentValueSOL = priceNative && balanceNum ? priceNative * balanceNum : null;
      // P/L% since purchase: (currentValue - cost) / cost * 100
      let pnlPercent: number | null = null;
      if (costBasisSOL && costBasisSOL > 0 && currentValueSOL !== null) {
        pnlPercent = ((currentValueSOL - costBasisSOL) / costBasisSOL) * 100;
      }

      return {
        mint: t.mint,
        balance: t.balance,
        decimals: t.decimals,
        rawAmount: t.rawAmount,
        // DexScreener enrichment
        name: pair?.baseToken?.name ?? null,
        symbol: pair?.baseToken?.symbol ?? null,
        priceUsd: priceUsd,
        valueUsd: valueUsd,
        priceChange: pair?.priceChange ?? null,
        marketCap: pair?.marketCap ?? null,
        fdv: pair?.fdv ?? null,
        liquidity: pair?.liquidity?.usd ?? null,
        imageUrl: pair?.info?.imageUrl ?? null,
        dexUrl: pair?.url ?? null,
        dexId: pair?.dexId ?? null,
        // Cost basis / P&L from TRADES.json
        costBasisSOL: costBasisSOL,
        currentValueSOL: currentValueSOL,
        pnlPercent: pnlPercent !== null ? Math.round(pnlPercent * 10) / 10 : null,
        boughtAt: pos?.boughtAt ?? null,
      };
    });

    // Sort by USD value descending (tokens with value first)
    tokens.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

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
// Uses TRADES.json (bot's trade ledger) as the primary source for buy/sell
// activity, enriched with DexScreener token data. Falls back to RPC for
// SOL transfers and other on-chain activity not recorded in TRADES.json.
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

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

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

  try {
    // Primary source: TRADES.json from the bot's workspace
    const tradesData = readTradesJson(user.telegramId);
    const trades = tradesData?.trades ?? [];

    // Deduplicate trades: same mint + action + solAmount within 60s = duplicate
    const uniqueTrades: typeof trades = [];
    for (const t of trades) {
      const tTime = t.timestamp ? new Date(t.timestamp).getTime() : 0;
      const isDupe = uniqueTrades.some(u => {
        if (u.mint !== t.mint || u.action !== t.action || u.solAmount !== t.solAmount) return false;
        const uTime = u.timestamp ? new Date(u.timestamp).getTime() : 0;
        return Math.abs(tTime - uTime) < 60000; // within 60 seconds
      });
      if (!isDupe) {
        uniqueTrades.push(t);
      }
    }

    // Get recent trades (most recent first), limited
    const recentTrades = uniqueTrades.slice(-limit).reverse();

    // Collect all mints for DexScreener enrichment
    const tradeMints = new Set<string>();
    for (const t of recentTrades) {
      if (t.mint) tradeMints.add(t.mint);
    }
    const dexData = tradeMints.size > 0 ? await fetchDexScreenerTokens([...tradeMints]) : new Map();

    // Build transaction list from TRADES.json
    const transactions = recentTrades.map((trade) => {
      const pair = dexData.get(trade.mint);
      const tokenChanges = trade.mint ? [{
        mint: trade.mint,
        change: trade.action === "buy"
          ? (trade.tokenAmount ? trade.tokenAmount.toFixed(6) : "0")
          : (trade.tokenAmount ? (-trade.tokenAmount).toFixed(6) : "0"),
        symbol: pair?.baseToken?.symbol ?? null,
        name: pair?.baseToken?.name ?? null,
        imageUrl: pair?.info?.imageUrl ?? null,
      }] : null;

      return {
        signature: null as string | null,
        blockTime: trade.timestamp ? Math.floor(new Date(trade.timestamp).getTime() / 1000) : null,
        type: trade.action === "buy" ? "buy" : trade.action === "sell" ? "sell" : trade.action,
        success: true,
        solChange: trade.action === "buy"
          ? (-trade.solAmount).toFixed(6)
          : trade.solAmount.toFixed(6),
        tokenChanges,
        profitSOL: trade.profitSOL ?? null,
      };
    });

    // Also fetch recent on-chain signatures to capture SOL transfers
    // (funding, withdrawals) that TRADES.json doesn't record
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    try {
      const sigResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(8_000),
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getSignaturesForAddress",
          params: [address, { limit: Math.min(limit, 20) }],
        }),
      });
      const sigData = await sigResponse.json() as {
        result?: Array<{
          signature: string;
          blockTime: number | null;
          err: unknown;
        }>;
      };

      const sigs = sigData.result ?? [];
      if (sigs.length > 0) {
        // Batch-fetch transaction details
        const batchBody = sigs.map((sig, i) => ({
          jsonrpc: "2.0", id: i,
          method: "getTransaction",
          params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
        }));
        const batchResp = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
          body: JSON.stringify(batchBody),
        });
        const batchData = await batchResp.json() as Array<{ id: number; result?: unknown }>;
        const resultMap = new Map<number, unknown>();
        if (Array.isArray(batchData)) {
          for (const item of batchData) resultMap.set(item.id, item.result ?? null);
        }

        for (let i = 0; i < sigs.length; i++) {
          const sig = sigs[i];
          const tx = resultMap.get(i) as {
            meta?: {
              preBalances?: number[];
              postBalances?: number[];
              preTokenBalances?: Array<{ mint: string; owner: string }>;
              postTokenBalances?: Array<{ mint: string; owner: string }>;
              err: unknown;
            };
            transaction?: {
              message?: {
                accountKeys?: Array<{ pubkey?: string }> | string[];
              };
            };
          } | null;

          if (!tx?.meta) continue;

          // Find wallet index
          let walletIndex = 0;
          const accountKeys = tx.transaction?.message?.accountKeys;
          if (accountKeys?.length) {
            const idx = accountKeys.findIndex((key) => {
              const pk = typeof key === "string" ? key : key.pubkey;
              return pk === address;
            });
            if (idx >= 0) walletIndex = idx;
          }

          const preSOL = (tx.meta.preBalances?.[walletIndex] || 0) / 1e9;
          const postSOL = (tx.meta.postBalances?.[walletIndex] || 0) / 1e9;
          const solChange = postSOL - preSOL;

          // Check if this involves token changes (would be a buy/sell already in TRADES.json)
          const hasTokenChange = (tx.meta.preTokenBalances?.some(t => t.owner === address) ||
                                  tx.meta.postTokenBalances?.some(t => t.owner === address));

          // Only add pure SOL transfers (not already captured by TRADES.json buys/sells)
          if (!hasTokenChange && Math.abs(solChange) > 0.0001) {
            const type = solChange > 0 ? "receive" : "send";
            transactions.push({
              signature: sig.signature,
              blockTime: sig.blockTime,
              type,
              success: !tx.meta.err,
              solChange: solChange.toFixed(6),
              tokenChanges: null,
              profitSOL: null,
            });
          }
        }
      }
    } catch {
      // RPC enrichment failed — TRADES.json data is still good
    }

    // Sort by blockTime descending (most recent first)
    transactions.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));

    // Limit to requested count
    const limited = transactions.slice(0, limit);

    return c.json({
      address,
      transactions: limited,
      count: limited.length,
    });
  } catch (err) {
    console.error("Failed to fetch transactions:", err);
    return c.json({ error: "Failed to fetch transaction history" }, 500);
  }
});

// ── Get wallet trading stats ────────────────────────────────────────
// Computes daily P/L, win rate, total profit from TRADES.json
instanceRoutes.get("/:id/wallet/stats", async (c) => {
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

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const tradesData = readTradesJson(user.telegramId);
  if (!tradesData) {
    return c.json({
      today: { profit: 0, trades: 0, wins: 0, losses: 0, winRate: 0 },
      week: [] as Array<{ date: string; profit: number; trades: number; wins: number; losses: number; winRate: number }>,
      allTime: { profit: 0, trades: 0, wins: 0, losses: 0, winRate: 0 },
      activePositions: 0,
    });
  }

  // Today's date key
  const todayKey = new Date().toISOString().split("T")[0];
  const dailyPL = tradesData.dailyPL ?? {};

  // Today's stats
  const todayData = dailyPL[todayKey] ?? { profit: 0, trades: 0, wins: 0, losses: 0 };
  const todayWinRate = todayData.trades > 0 ? (todayData.wins / todayData.trades) * 100 : 0;

  // Last 7 days breakdown
  const week: Array<{ date: string; profit: number; trades: number; wins: number; losses: number; winRate: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const day = dailyPL[key] ?? { profit: 0, trades: 0, wins: 0, losses: 0 };
    week.push({
      date: key,
      profit: day.profit,
      trades: day.trades,
      wins: day.wins,
      losses: day.losses,
      winRate: day.trades > 0 ? (day.wins / day.trades) * 100 : 0,
    });
  }

  // All-time stats — aggregate from dailyPL for wins/losses, use totalProfitSOL for profit
  let allTimeWins = 0;
  let allTimeLosses = 0;
  let allTimeTrades = 0;
  for (const day of Object.values(dailyPL)) {
    allTimeWins += day.wins;
    allTimeLosses += day.losses;
    allTimeTrades += day.trades;
  }
  // If dailyPL has no data, count sell trades from the trades array
  if (allTimeTrades === 0 && tradesData.trades.length > 0) {
    for (const t of tradesData.trades) {
      if (t.action === "sell") {
        allTimeTrades++;
        if (t.profitSOL !== undefined && t.profitSOL > 0) allTimeWins++;
        else if (t.profitSOL !== undefined && t.profitSOL <= 0) allTimeLosses++;
      }
    }
  }
  const allTimeWinRate = allTimeTrades > 0 ? (allTimeWins / allTimeTrades) * 100 : 0;

  // Active positions count
  const activePositions = Object.values(tradesData.positions ?? {}).filter(
    (p) => p.totalTokens > 0
  ).length;

  return c.json({
    today: {
      profit: todayData.profit,
      trades: todayData.trades,
      wins: todayData.wins,
      losses: todayData.losses,
      winRate: todayWinRate,
    },
    week,
    allTime: {
      profit: tradesData.totalProfitSOL ?? 0,
      trades: allTimeTrades,
      wins: allTimeWins,
      losses: allTimeLosses,
      winRate: allTimeWinRate,
    },
    activePositions,
  });
});

// ── Liquidate: sell all tokens + transfer SOL to user wallet ─────────
// PumpPortal trade helpers (matches pumpfun-trade.js approach)
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58encode(buffer: Buffer): string {
  const bytes = [...buffer];
  let result = "";
  let lz = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    lz++;
  }
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  result = "1".repeat(lz);
  for (let i = digits.length - 1; i >= 0; i--) result += B58[digits[i]];
  return result;
}

function b58decode(str: string): Buffer {
  const bytes: number[] = [];
  for (const c of str) {
    const idx = B58.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base58 character: ${c}`);
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const c of str) {
    if (c !== "1") break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}

function deserializeSolanaTx(data: Buffer) {
  let off = 0;
  let sigCount = 0;
  let shift = 0;
  while (true) {
    const b = data[off++];
    sigCount |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  const sigsStart = off;
  off += sigCount * 64;
  const msg = data.subarray(off);
  return { buf: data, sigCount, sigsStart, msg };
}

async function sellTokenViaPumpPortal(
  mint: string,
  walletAddress: string,
  privateKeyB58: string,
  rpcUrl: string,
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    // Build PumpPortal trade request — sell 100%
    const tradeReq = {
      publicKey: walletAddress,
      action: "sell",
      mint: mint,
      denominatedInSol: "false",
      amount: "100%",
      slippage: 25, // Higher slippage for liquidation to ensure fill
      priorityFee: 0.001,
      pool: "auto",
    };

    // Get unsigned transaction from PumpPortal
    const ppResponse = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tradeReq),
    });

    if (!ppResponse.ok) {
      const errorText = await ppResponse.text();
      return { success: false, error: `PumpPortal HTTP ${ppResponse.status}: ${errorText.substring(0, 200)}` };
    }

    const txBytes = Buffer.from(await ppResponse.arrayBuffer());
    if (txBytes.length < 100) {
      return { success: false, error: `PumpPortal returned invalid tx (${txBytes.length} bytes): ${txBytes.toString().substring(0, 200)}` };
    }

    // Deserialize & sign
    const tx = deserializeSolanaTx(txBytes);

    // Sign the message with bot's Ed25519 key
    const buf = b58decode(privateKeyB58);
    const seed = buf.length === 64 ? buf.subarray(0, 32) : buf;
    const pk = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        seed,
      ]),
      format: "der",
      type: "pkcs8",
    });
    const walletSig = cryptoSign(null, tx.msg, pk);

    // Replace the first signature slot with our signature
    const signedTx = Buffer.concat([
      tx.buf.subarray(0, tx.sigsStart),
      walletSig,
      tx.buf.subarray(tx.sigsStart + 64),
    ]);

    // Submit to Solana RPC
    const rpcResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [
          signedTx.toString("base64"),
          {
            encoding: "base64",
            skipPreflight: true,
            preflightCommitment: "confirmed",
            maxRetries: 3,
          },
        ],
      }),
    });

    const rpcData = (await rpcResponse.json()) as {
      result?: string;
      error?: { message?: string };
    };

    if (rpcData.error) {
      return { success: false, error: rpcData.error.message || "RPC error" };
    }

    return { success: true, signature: rpcData.result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

const liquidateSchema = z.object({
  destinationWallet: z.string().min(32).max(44),
});

instanceRoutes.post("/:id/liquidate", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  // Validate body
  const body = await c.req.json().catch(() => null);
  const parsed = liquidateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid destination wallet address" }, 400);
  }
  const { destinationWallet } = parsed.data;

  // Validate destination is a valid Solana public key
  try {
    new PublicKey(destinationWallet);
  } catch {
    return c.json({ error: "Invalid Solana address" }, 400);
  }

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) {
    return c.json({ error: "Instance not found" }, 404);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  // Read wallet (including private key — server-side only, never exposed)
  const walletPath = resolve(
    INSTANCES_DATA_DIR,
    `user-${user.telegramId}`,
    ".wallet.json",
  );

  if (!existsSync(walletPath)) {
    return c.json({ error: "Bot wallet not yet created" }, 404);
  }

  let walletData: { publicKey: string; privateKey: string };
  try {
    walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
  } catch {
    return c.json({ error: "Failed to read wallet data" }, 500);
  }

  const { publicKey: botAddress, privateKey: botPrivateKey } = walletData;
  const rpcUrl =
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  const results: Array<{
    step: string;
    success: boolean;
    signature?: string;
    error?: string;
    mint?: string;
    symbol?: string;
  }> = [];

  // ── Step 1: Get all token holdings ──────────────────────────
  const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

  type TokenAccountResult = {
    result?: {
      value?: Array<{
        pubkey: string;
        account: {
          data: {
            parsed: {
              info: {
                mint: string;
                tokenAmount: {
                  amount: string;
                  decimals: number;
                  uiAmountString: string;
                };
              };
            };
          };
        };
      }>;
    };
    error?: { message?: string };
  };

  let tokensToSell: Array<{
    mint: string;
    balance: string;
    symbol: string | null;
  }> = [];

  try {
    const [r1, r2] = await Promise.all([
      fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            botAddress,
            { programId: TOKEN_PROGRAM },
            { encoding: "jsonParsed" },
          ],
        }),
      }),
      fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "getTokenAccountsByOwner",
          params: [
            botAddress,
            { programId: TOKEN_2022_PROGRAM },
            { encoding: "jsonParsed" },
          ],
        }),
      }),
    ]);

    const [d1, d2] = await Promise.all([
      r1.json() as Promise<TokenAccountResult>,
      r2.json() as Promise<TokenAccountResult>,
    ]);

    const allAccounts = [
      ...(d1.result?.value || []),
      ...(d2.result?.value || []),
    ];

    const rawTokens = allAccounts
      .map((a) => ({
        mint: a.account.data.parsed.info.mint,
        balance: a.account.data.parsed.info.tokenAmount.uiAmountString,
        rawAmount: a.account.data.parsed.info.tokenAmount.amount,
      }))
      .filter((t) => parseFloat(t.balance) > 0 && t.rawAmount !== "0");

    // Get token symbols from DexScreener
    const dexData = await fetchDexScreenerTokens(rawTokens.map((t) => t.mint));

    tokensToSell = rawTokens.map((t) => ({
      mint: t.mint,
      balance: t.balance,
      symbol: dexData.get(t.mint)?.baseToken?.symbol ?? null,
    }));
  } catch (err) {
    return c.json({
      error: "Failed to fetch token holdings",
      details: err instanceof Error ? err.message : "Unknown error",
    }, 500);
  }

  // ── Step 2: Sell all tokens via PumpPortal ──────────────────
  for (const token of tokensToSell) {
    console.log(
      `[liquidate] Selling ${token.balance} ${token.symbol || token.mint.slice(0, 8)}...`,
    );
    const sellResult = await sellTokenViaPumpPortal(
      token.mint,
      botAddress,
      botPrivateKey,
      rpcUrl,
    );
    results.push({
      step: "sell",
      success: sellResult.success,
      signature: sellResult.signature,
      error: sellResult.error,
      mint: token.mint,
      symbol: token.symbol ?? undefined,
    });

    // Small delay between sells to avoid rate limiting
    if (tokensToSell.indexOf(token) < tokensToSell.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // ── Step 3: Wait for sells to settle, then transfer SOL ─────
  // Wait a bit for sell transactions to land
  if (tokensToSell.length > 0) {
    await new Promise((r) => setTimeout(r, 3000));
  }

  try {
    // Build keypair from bot's private key
    const keyBuf = b58decode(botPrivateKey);
    // The key is 64 bytes: 32-byte seed + 32-byte public key
    const keypair = Keypair.fromSecretKey(
      keyBuf.length === 64 ? keyBuf : Buffer.concat([keyBuf, b58decode(botAddress)]),
    );

    const connection = new Connection(rpcUrl, "confirmed");

    // Get current balance
    const balance = await connection.getBalance(keypair.publicKey);

    // To fully drain, we need to compute the exact fee and send balance - fee.
    // Build the transaction first with a placeholder amount, get the fee, then adjust.
    const ESTIMATED_FEE = 5_000; // 5000 lamports is the standard fee for a simple transfer
    const transferAmount = balance - ESTIMATED_FEE;

    if (transferAmount <= 0) {
      results.push({
        step: "transfer",
        success: false,
        error: `Insufficient balance for transfer (${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL, need >0.000005 SOL for fee)`,
      });
    } else {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: new PublicKey(destinationWallet),
          lamports: transferAmount,
        }),
      );

      // Get recent blockhash and compute exact fee
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = keypair.publicKey;

      // Get the exact fee for this transaction
      const fee = await transaction.getEstimatedFee(connection);
      const exactTransferAmount = balance - (fee ?? ESTIMATED_FEE);

      if (exactTransferAmount <= 0) {
        results.push({
          step: "transfer",
          success: false,
          error: `Insufficient balance after fee (${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL, fee: ${((fee ?? ESTIMATED_FEE) / LAMPORTS_PER_SOL).toFixed(6)} SOL)`,
        });
      } else {
        // Rebuild with exact amount to drain fully (account goes to 0 lamports)
        const drainTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: new PublicKey(destinationWallet),
            lamports: exactTransferAmount,
          }),
        );
        drainTx.recentBlockhash = blockhash;
        drainTx.feePayer = keypair.publicKey;

        const signature = await sendAndConfirmTransaction(
          connection,
          drainTx,
          [keypair],
          { commitment: "confirmed" },
        );

        results.push({
          step: "transfer",
          success: true,
          signature,
        });

        console.log(
          `[liquidate] Transferred ${(exactTransferAmount / LAMPORTS_PER_SOL).toFixed(6)} SOL to ${destinationWallet}. Sig: ${signature}`,
        );
      }
    }
  } catch (err) {
    results.push({
      step: "transfer",
      success: false,
      error: err instanceof Error ? err.message : "Transfer failed",
    });
  }

  // ── Step 4: Clear TRADES.json positions ─────────────────────
  try {
    const tradesPath = resolve(
      INSTANCES_DATA_DIR,
      `user-${user.telegramId}`,
      "workspace",
      "TRADES.json",
    );
    if (existsSync(tradesPath)) {
      const tradesData = JSON.parse(readFileSync(tradesPath, "utf-8"));
      // Record liquidation sells in trade history
      for (const token of tokensToSell) {
        const sellResult = results.find(
          (r) => r.step === "sell" && r.mint === token.mint && r.success,
        );
        if (sellResult) {
          tradesData.trades = tradesData.trades || [];
          tradesData.trades.push({
            timestamp: new Date().toISOString(),
            action: "sell",
            mint: token.mint,
            solAmount: 0, // Unknown exact proceeds from 100% sell
            note: "liquidation",
          });
        }
      }
      // Clear all positions
      tradesData.positions = {};
      writeFileSync(tradesPath, JSON.stringify(tradesData, null, 2));
    }
  } catch {
    // Non-critical — log but don't fail
    console.error("[liquidate] Failed to update TRADES.json");
  }

  const sellResults = results.filter((r) => r.step === "sell");
  const transferResult = results.find((r) => r.step === "transfer");
  const successfulSells = sellResults.filter((r) => r.success).length;
  const failedSells = sellResults.filter((r) => !r.success).length;

  return c.json({
    success: (transferResult?.success ?? true) && failedSells === 0,
    summary: {
      tokensFound: tokensToSell.length,
      tokensSold: successfulSells,
      tokensFailed: failedSells,
      solTransferred: transferResult?.success ?? false,
      transferSignature: transferResult?.signature ?? null,
    },
    results,
  });
});

export default instanceRoutes;
