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
import { completedAnthropicTokens } from "./anthropic-auth";

type Variables = { userId: number };
const instanceRoutes = new Hono<{ Variables: Variables }>();

const DEFAULT_MODEL = "openrouter/moonshotai/kimi-k2.5";

// ── SOL Price Cache ─────────────────────────────────────────────────
// Cache SOL/USD price for 60 seconds to avoid excessive API calls
let cachedSolPrice: { usd: number; ts: number } | null = null;
const SOL_PRICE_CACHE_TTL = 60_000;

async function fetchSolPrice(): Promise<number | null> {
  const now = Date.now();
  if (cachedSolPrice && now - cachedSolPrice.ts < SOL_PRICE_CACHE_TTL) {
    return cachedSolPrice.usd;
  }

  try {
    // Use CoinGecko for SOL/USD price (free, reliable, no auth required)
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!resp.ok) return cachedSolPrice?.usd ?? null;

    const data = await resp.json() as { solana?: { usd?: number } };
    const price = data.solana?.usd;

    if (price && price > 0) {
      cachedSolPrice = { usd: price, ts: now };
      return price;
    }
  } catch {
    // Return cached price if fetch fails
  }

  return cachedSolPrice?.usd ?? null;
}

// ── MON Price Cache ─────────────────────────────────────────────────
// Cache MON/USD price for 60 seconds (same pattern as SOL)
let cachedMonPrice: { usd: number; ts: number } | null = null;
const MON_PRICE_CACHE_TTL = 60_000;

async function fetchMonPrice(): Promise<number | null> {
  const now = Date.now();
  if (cachedMonPrice && now - cachedMonPrice.ts < MON_PRICE_CACHE_TTL) {
    return cachedMonPrice.usd;
  }

  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd",
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!resp.ok) return cachedMonPrice?.usd ?? null;

    const data = await resp.json() as { monad?: { usd?: number } };
    const price = data.monad?.usd;

    if (price && price > 0) {
      cachedMonPrice = { usd: price, ts: now };
      return price;
    }
  } catch {
    // Return cached price if fetch fails
  }

  return cachedMonPrice?.usd ?? null;
}

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
  user: { id: number; telegramId: string; photoUrl?: string | null },
  overrides?: { 
    telegramBotToken?: string; 
    openrouterApiKey?: string; 
    model?: string;
    anthropicSetupToken?: string;
  }
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
    ownerAvatarUrl: user.photoUrl || undefined,
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

  // Add Anthropic setup-token if using Anthropic provider
  if (instance.llmProvider === "anthropic") {
    // Use override (plaintext) if available, otherwise decrypt from DB
    if (overrides?.anthropicSetupToken) {
      config.anthropicSetupToken = overrides.anthropicSetupToken;
    } else if (instance.anthropicSetupToken) {
      config.anthropicSetupToken = decrypt(instance.anthropicSetupToken);
    }
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
  llmProvider: z.enum(["openrouter", "openai-codex", "anthropic"]).default("openrouter"),
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
  const model = parsed.data.model || (
    llmProvider === "openai-codex" ? "openai-codex/gpt-5.3-codex" :
    llmProvider === "anthropic" ? "anthropic/claude-sonnet-4-20250514" :
    DEFAULT_MODEL
  );

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

  // For Anthropic, retrieve setup-token from the completed auth flow
  let anthropicToken: { setupToken: string } | undefined;
  if (llmProvider === "anthropic") {
    anthropicToken = completedAnthropicTokens.get(userId);
    if (!anthropicToken) {
      return c.json({ error: "Anthropic authentication required. Please paste your setup-token first." }, 400);
    }
    completedAnthropicTokens.delete(userId); // Consume the token
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
      ...(anthropicToken && {
        anthropicSetupToken: encrypt(anthropicToken.setupToken),
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
        anthropicSetupToken: anthropicToken?.setupToken,
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
    costBasisSOL?: number;
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

// --- Monad TRADES reader ---
type MonadTradesData = {
  trades: Array<{
    type: string; // "buy" | "sell"
    chain: string;
    token: string;
    mon: number;
    timestamp: string;
    profit?: number;
  }>;
  positions: Record<string, {
    totalCost: number;
    buyCount: number;
    firstBuy: number;
  }>;
  daily: Record<string, {
    profit: number;
    trades: number;
    wins: number;
    losses: number;
  }>;
  totalProfitMON: number;
};

function readMonadTradesJson(telegramId: string): MonadTradesData | null {
  const tradesPath = resolve(INSTANCES_DATA_DIR, `user-${telegramId}`, "workspace", "MONAD_TRADES.json");
  try {
    if (!existsSync(tradesPath)) return null;
    const data = JSON.parse(readFileSync(tradesPath, "utf-8"));
    return data as MonadTradesData;
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

  // Read wallets from user's data directory (uses telegramId, not database id)
  const dataDir = resolve(INSTANCES_DATA_DIR, `user-${user.telegramId}`);
  const walletPath = resolve(dataDir, ".wallet.json");
  const evmWalletPath = resolve(dataDir, ".evm-wallet.json");
  
  let solanaAddress: string | null = null;
  let monadAddress: string | null = null;

  if (existsSync(walletPath)) {
    try {
      const walletData = JSON.parse(readFileSync(walletPath, "utf-8"));
      solanaAddress = walletData.publicKey;
    } catch {}
  }

  if (existsSync(evmWalletPath)) {
    try {
      const evmWalletData = JSON.parse(readFileSync(evmWalletPath, "utf-8"));
      monadAddress = evmWalletData.address;
    } catch {}
  }

  if (!solanaAddress && !monadAddress) {
    return c.json({ 
      address: null, 
      solana: null,
      monad: null,
      message: "Wallets not yet created. Start your bot to generate wallets." 
    });
  }

  const monadTestnet = process.env.MONAD_TESTNET === "true";
  return c.json({
    address: solanaAddress, // backward compat
    solana: solanaAddress ? { address: solanaAddress } : null,
    monad: monadAddress ? { address: monadAddress, testnet: monadTestnet } : null,
  });
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

  // Read wallet addresses (uses telegramId, not database id)
  const dataDir = resolve(INSTANCES_DATA_DIR, `user-${user.telegramId}`);
  const walletPath = resolve(dataDir, ".wallet.json");
  const evmWalletPath = resolve(dataDir, ".evm-wallet.json");
  
  let solAddress: string | null = null;
  let monadAddress: string | null = null;

  try {
    if (existsSync(walletPath)) {
      solAddress = JSON.parse(readFileSync(walletPath, "utf-8")).publicKey;
    }
  } catch {}

  try {
    if (existsSync(evmWalletPath)) {
      monadAddress = JSON.parse(readFileSync(evmWalletPath, "utf-8")).address;
    }
  } catch {}

  if (!solAddress && !monadAddress) {
    return c.json({ error: "Wallets not yet created" }, 404);
  }

  const result: Record<string, unknown> = {};

  // Fetch Solana balance
  if (solAddress) {
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getBalance",
          params: [solAddress],
        }),
      });

      const data = await response.json() as { result?: { value?: number }, error?: { message?: string } };
      const lamports = data.result?.value || 0;
      const sol = lamports / 1_000_000_000;
      const solPriceUsd = await fetchSolPrice();
      const usd = solPriceUsd ? sol * solPriceUsd : null;

      result.solana = {
        address: solAddress,
        lamports,
        sol,
        formatted: sol.toFixed(4) + " SOL",
        solPriceUsd,
        usd,
      };
    } catch (err) {
      console.error("Failed to fetch Solana balance:", err);
      result.solana = { address: solAddress, error: "Failed to fetch balance" };
    }

    // Backward compat
    if (result.solana && typeof result.solana === 'object' && 'sol' in result.solana) {
      const s = result.solana as { address: string; lamports: number; sol: number; formatted: string; solPriceUsd: number | null; usd: number | null };
      result.address = s.address;
      result.lamports = s.lamports;
      result.sol = s.sol;
      result.formatted = s.formatted;
      result.solPriceUsd = s.solPriceUsd;
      result.usd = s.usd;
    }
  }

  // Fetch Monad balance
  if (monadAddress) {
    const monadTestnet = process.env.MONAD_TESTNET === "true";
    const monadRpcUrl = process.env.MONAD_RPC_URL || (
      monadTestnet ? "https://monad-testnet.drpc.org" : "https://monad-mainnet.drpc.org"
    );
    try {
      const response = await fetch(monadRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBalance",
          params: [monadAddress, "latest"],
        }),
      });

      const data = await response.json() as { result?: string, error?: { message?: string } };
      
      if (data.error) {
        result.monad = { address: monadAddress, error: data.error.message };
      } else {
        const weiHex = data.result || "0x0";
        const wei = BigInt(weiHex);
        const mon = Number(wei) / 1e18;
        const monPriceUsd = await fetchMonPrice();
        const monUsd = monPriceUsd ? mon * monPriceUsd : null;

        result.monad = {
          address: monadAddress,
          wei: wei.toString(),
          mon,
          formatted: mon.toFixed(4) + " MON",
          monPriceUsd,
          usd: monUsd,
        };
      }
    } catch (err) {
      console.error("Failed to fetch Monad balance:", err);
      result.monad = { address: monadAddress, error: "Failed to fetch balance" };
    }
  }

  return c.json(result);
});

// ── Get SOL price in USD ────────────────────────────────────────────
// Returns cached SOL/USD price (30s TTL) for frontend USD calculations
instanceRoutes.get("/solana/price", async (c) => {
  const price = await fetchSolPrice();
  if (price === null) {
    return c.json({ error: "Failed to fetch SOL price" }, 502);
  }
  return c.json({ solPriceUsd: price });
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

      // For sells, solAmount might be 0 (auto-recorded before SOL received is known)
      // or a bogus value like 100 (from "100%" token sell parsed as number).
      // Compute real SOL received from costBasisSOL + profitSOL if available.
      let solChange: string | null = null;
      if (trade.action === "buy") {
        solChange = (-trade.solAmount).toFixed(6);
      } else if (trade.action === "sell") {
        // Try to compute actual SOL received
        if (trade.solAmount > 0 && trade.solAmount < 0.5) {
          // Reasonable sell SOL amount recorded directly
          solChange = trade.solAmount.toFixed(6);
        } else if (trade.costBasisSOL != null && trade.profitSOL != null) {
          // Compute from cost basis + profit: solReceived = cost + profit
          const computed = trade.costBasisSOL + trade.profitSOL;
          if (computed > 0) {
            solChange = computed.toFixed(6);
          }
        }
        // If neither works, solChange stays null (won't display amount)
      }

      return {
        signature: null as string | null,
        blockTime: trade.timestamp ? Math.floor(new Date(trade.timestamp).getTime() / 1000) : null,
        type: trade.action === "buy" ? "buy" : trade.action === "sell" ? "sell" : trade.action,
        success: true,
        solChange,
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

  // Sanitize totalProfitSOL: if it's unreasonably large (> 1 SOL for micro-trading bots),
  // it was corrupted by the "100%" sell amount bug. Recompute from individual trade profitSOL values.
  if (Math.abs(tradesData.totalProfitSOL ?? 0) > 1) {
    let recomputed = 0;
    for (const t of tradesData.trades ?? []) {
      if (t.action === "sell" && typeof t.profitSOL === "number" && Math.abs(t.profitSOL) < 1) {
        recomputed += t.profitSOL;
      }
    }
    tradesData.totalProfitSOL = recomputed;
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

  // Active positions count (include positions with totalTokens > 0 OR totalCostSOL > 0)
  const activePositions = Object.values(tradesData.positions ?? {}).filter(
    (p) => (p.totalTokens > 0) || (p.totalCostSOL > 0)
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

// ══════════════════════════════════════════════════════════════════════
// ══  Monad wallet routes (tokens, transactions, stats from MONAD_TRADES.json)
// ══════════════════════════════════════════════════════════════════════

// ── Get Monad token holdings (active positions from MONAD_TRADES.json) ──
instanceRoutes.get("/:id/wallet/monad/tokens", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid instance ID" }, 400);

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  const monadTrades = readMonadTradesJson(user.telegramId);
  if (!monadTrades || Object.keys(monadTrades.positions).length === 0) {
    return c.json({ tokens: [] });
  }

  const tokens = Object.entries(monadTrades.positions).map(([token, pos]) => ({
    address: token,
    totalCostMON: pos.totalCost,
    buyCount: pos.buyCount,
    firstBuy: pos.firstBuy ? new Date(pos.firstBuy).toISOString() : null,
    ageMinutes: pos.firstBuy ? Math.floor((Date.now() - pos.firstBuy) / 60000) : null,
  }));

  return c.json({ tokens });
});

// ── Get Monad transaction history (trades from MONAD_TRADES.json) ──
instanceRoutes.get("/:id/wallet/monad/transactions", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid instance ID" }, 400);

  const limit = Math.min(safeParseInt(c.req.query("limit") ?? "") ?? 50, 200);

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  const monadTrades = readMonadTradesJson(user.telegramId);
  if (!monadTrades || monadTrades.trades.length === 0) {
    return c.json({ transactions: [], count: 0 });
  }

  // Return most recent first
  const transactions = monadTrades.trades
    .slice()
    .reverse()
    .slice(0, limit)
    .map((t) => ({
      type: t.type,
      chain: "monad",
      token: t.token,
      monAmount: t.mon,
      timestamp: t.timestamp,
      profitMON: t.profit ?? null,
    }));

  return c.json({ transactions, count: transactions.length });
});

// ── Get Monad trading stats (from MONAD_TRADES.json daily P/L) ──
instanceRoutes.get("/:id/wallet/monad/stats", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid instance ID" }, 400);

  const instance = await db.query.instances.findFirst({
    where: and(eq(instances.id, id), eq(instances.userId, userId)),
  });
  if (!instance) return c.json({ error: "Instance not found" }, 404);

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return c.json({ error: "User not found" }, 404);

  const monadTrades = readMonadTradesJson(user.telegramId);
  const emptyDay = { profit: 0, trades: 0, wins: 0, losses: 0, winRate: 0 };
  if (!monadTrades) {
    return c.json({
      today: emptyDay,
      week: [] as Array<typeof emptyDay & { date: string }>,
      allTime: emptyDay,
      activePositions: 0,
    });
  }

  const todayKey = new Date().toISOString().split("T")[0];
  const daily = monadTrades.daily ?? {};

  // Today's stats
  const todayData = daily[todayKey] ?? { profit: 0, trades: 0, wins: 0, losses: 0 };
  const todayWinRate = todayData.trades > 0 ? (todayData.wins / todayData.trades) * 100 : 0;

  // Last 7 days
  const week: Array<{ date: string; profit: number; trades: number; wins: number; losses: number; winRate: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const day = daily[key] ?? { profit: 0, trades: 0, wins: 0, losses: 0 };
    week.push({
      date: key,
      profit: day.profit,
      trades: day.trades,
      wins: day.wins,
      losses: day.losses,
      winRate: day.trades > 0 ? (day.wins / day.trades) * 100 : 0,
    });
  }

  // All-time stats
  let allTimeWins = 0, allTimeLosses = 0, allTimeTrades = 0;
  for (const day of Object.values(daily)) {
    allTimeWins += day.wins;
    allTimeLosses += day.losses;
    allTimeTrades += day.trades;
  }
  const allTimeWinRate = allTimeTrades > 0 ? (allTimeWins / allTimeTrades) * 100 : 0;

  const activePositions = Object.keys(monadTrades.positions ?? {}).length;

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
      profit: monadTrades.totalProfitMON ?? 0,
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

// ══════════════════════════════════════════════════════════════════════
//  MONAD LIQUIDATION — sell all nad.fun tokens + transfer all MON
// ══════════════════════════════════════════════════════════════════════

// Import viem for EVM transaction construction
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  encodeFunctionData,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Monad chain config (matches monad-common.js)
const MONAD_MAINNET_CONFIG = {
  chainId: 143,
  rpcUrl: "https://monad-mainnet.drpc.org",
  LENS: "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea" as Address,
};

const MONAD_TESTNET_CONFIG = {
  chainId: 10143,
  rpcUrl: "https://monad-testnet.drpc.org",
  LENS: "0xB056d79CA5257589692699a46623F901a3BB76f1" as Address,
};

function getMonadConfig() {
  const isTestnet = process.env.MONAD_TESTNET === "true";
  const cfg = isTestnet ? MONAD_TESTNET_CONFIG : MONAD_MAINNET_CONFIG;
  return {
    ...cfg,
    isTestnet,
    rpcUrl: process.env.MONAD_RPC_URL || cfg.rpcUrl,
  };
}

function getMonadChain() {
  const cfg = getMonadConfig();
  return {
    id: cfg.chainId,
    name: cfg.isTestnet ? "Monad Testnet" : "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  } as const;
}

// Minimal ABIs needed for liquidation
const erc20BalanceOfAbi = [
  {
    type: "function" as const,
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view" as const,
  },
  {
    type: "function" as const,
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable" as const,
  },
  {
    type: "function" as const,
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view" as const,
  },
] as const;

const lensGetAmountOutAbi = [
  {
    type: "function" as const,
    name: "getAmountOut",
    inputs: [
      { name: "_token", type: "address" },
      { name: "_amountIn", type: "uint256" },
      { name: "_isBuy", type: "bool" },
    ],
    outputs: [
      { name: "router", type: "address" },
      { name: "amountOut", type: "uint256" },
    ],
    stateMutability: "view" as const,
  },
] as const;

const routerSellAbi = [
  {
    type: "function" as const,
    name: "sell",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMin", type: "uint256" },
          { name: "token", type: "address" },
          { name: "to", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable" as const,
  },
] as const;

const monadLiquidateSchema = z.object({
  destinationWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Invalid EVM address"),
});

instanceRoutes.post("/:id/liquidate/monad", async (c) => {
  const userId = c.get("userId");
  const id = safeParseInt(c.req.param("id"));
  if (id === null) {
    return c.json({ error: "Invalid instance ID" }, 400);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = monadLiquidateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid destination wallet address. Must be 0x + 40 hex chars." }, 400);
  }
  const { destinationWallet } = parsed.data;

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

  // Read EVM wallet
  const evmWalletPath = resolve(
    INSTANCES_DATA_DIR,
    `user-${user.telegramId}`,
    ".evm-wallet.json",
  );

  if (!existsSync(evmWalletPath)) {
    return c.json({ error: "Monad wallet not yet created" }, 404);
  }

  let walletData: { address: string; privateKey: string };
  try {
    walletData = JSON.parse(readFileSync(evmWalletPath, "utf-8"));
  } catch {
    return c.json({ error: "Failed to read Monad wallet data" }, 500);
  }

  const monadCfg = getMonadConfig();
  const monadChain = getMonadChain();

  const account = privateKeyToAccount(walletData.privateKey as Hex);
  const publicClient = createPublicClient({
    chain: monadChain,
    transport: http(monadCfg.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: monadChain,
    transport: http(monadCfg.rpcUrl),
  });

  const results: Array<{
    step: string;
    success: boolean;
    txHash?: string;
    error?: string;
    token?: string;
  }> = [];

  // ── Step 1: Get token positions from MONAD_TRADES.json ──────
  const monadTradesPath = resolve(
    INSTANCES_DATA_DIR,
    `user-${user.telegramId}`,
    "workspace",
    "MONAD_TRADES.json",
  );

  const tokensToSell: string[] = [];
  let tradesData: { trades: unknown[]; positions: Record<string, unknown>; daily: unknown; totalProfitMON: number } | null = null;

  try {
    if (existsSync(monadTradesPath)) {
      tradesData = JSON.parse(readFileSync(monadTradesPath, "utf-8"));
      if (tradesData?.positions) {
        tokensToSell.push(...Object.keys(tradesData.positions));
      }
    }
  } catch {
    console.error("[monad-liquidate] Failed to read MONAD_TRADES.json");
  }

  // ── Step 2: Sell all tokens via nad.fun router ──────────────
  for (const tokenAddr of tokensToSell) {
    try {
      console.log(`[monad-liquidate] Selling token ${tokenAddr}...`);

      // Check balance
      const tokenBalance = await publicClient.readContract({
        address: tokenAddr as Address,
        abi: erc20BalanceOfAbi,
        functionName: "balanceOf",
        args: [account.address],
      });

      if (tokenBalance === 0n) {
        results.push({ step: "sell", success: true, token: tokenAddr, error: "No balance (already sold)" });
        continue;
      }

      // Get sell quote
      const [router, amountOut] = await publicClient.readContract({
        address: monadCfg.LENS,
        abi: lensGetAmountOutAbi,
        functionName: "getAmountOut",
        args: [tokenAddr as Address, tokenBalance, false],
      });

      if (amountOut === 0n) {
        results.push({ step: "sell", success: false, token: tokenAddr, error: "Quote returned 0 MON" });
        continue;
      }

      // 5% slippage for liquidation (aggressive to ensure fills)
      const amountOutMin = (amountOut * 9500n) / 10000n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

      // Approve router
      const currentAllowance = await publicClient.readContract({
        address: tokenAddr as Address,
        abi: erc20BalanceOfAbi,
        functionName: "allowance",
        args: [account.address, router],
      });

      if (currentAllowance < tokenBalance) {
        const approveHash = await walletClient.writeContract({
          address: tokenAddr as Address,
          abi: erc20BalanceOfAbi,
          functionName: "approve",
          args: [router, tokenBalance],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // Build and send sell transaction
      const sellCallData = encodeFunctionData({
        abi: routerSellAbi,
        functionName: "sell",
        args: [
          {
            amountIn: tokenBalance,
            amountOutMin,
            token: tokenAddr as Address,
            to: account.address,
            deadline,
          },
        ],
      });

      const gasEstimate = await publicClient.estimateGas({
        account: account.address,
        to: router,
        data: sellCallData,
      });

      const sellHash = await walletClient.sendTransaction({
        to: router,
        data: sellCallData,
        gas: gasEstimate + gasEstimate / 10n,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: sellHash });

      if (receipt.status === "success") {
        results.push({ step: "sell", success: true, token: tokenAddr, txHash: sellHash });
        console.log(`[monad-liquidate] Sold ${tokenAddr}: ${sellHash}`);
      } else {
        results.push({ step: "sell", success: false, token: tokenAddr, txHash: sellHash, error: "Transaction reverted" });
      }

      // Small delay between sells
      if (tokensToSell.indexOf(tokenAddr) < tokensToSell.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch (err) {
      results.push({
        step: "sell",
        success: false,
        token: tokenAddr,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // ── Step 3: Wait for sells to settle, then transfer all MON ─
  if (tokensToSell.length > 0) {
    await new Promise((r) => setTimeout(r, 3000));
  }

  try {
    const balance = await publicClient.getBalance({ address: account.address });

    // Estimate gas cost for a simple transfer (21000 gas for native transfer)
    const gasPrice = await publicClient.getGasPrice();
    const gasCost = 21000n * gasPrice;
    const transferAmount = balance - gasCost;

    if (transferAmount <= 0n) {
      results.push({
        step: "transfer",
        success: false,
        error: `Insufficient balance for transfer (${formatEther(balance)} MON, need >${formatEther(gasCost)} MON for gas)`,
      });
    } else {
      const txHash = await walletClient.sendTransaction({
        to: destinationWallet as Address,
        value: transferAmount,
        gas: 21000n,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status === "success") {
        results.push({ step: "transfer", success: true, txHash });
        console.log(`[monad-liquidate] Transferred ${formatEther(transferAmount)} MON to ${destinationWallet}: ${txHash}`);
      } else {
        results.push({ step: "transfer", success: false, txHash, error: "Transfer reverted" });
      }
    }
  } catch (err) {
    results.push({
      step: "transfer",
      success: false,
      error: err instanceof Error ? err.message : "Transfer failed",
    });
  }

  // ── Step 4: Clear MONAD_TRADES.json positions ───────────────
  try {
    if (tradesData) {
      for (const tokenAddr of tokensToSell) {
        const sellResult = results.find(
          (r) => r.step === "sell" && r.token === tokenAddr && r.success,
        );
        if (sellResult) {
          tradesData.trades = (tradesData.trades as unknown[]) || [];
          (tradesData.trades as unknown[]).push({
            type: "sell",
            chain: "monad",
            token: tokenAddr,
            mon: 0,
            timestamp: new Date().toISOString(),
            note: "liquidation",
          });
        }
      }
      tradesData.positions = {};
      writeFileSync(monadTradesPath, JSON.stringify(tradesData, null, 2));
    }
  } catch {
    console.error("[monad-liquidate] Failed to update MONAD_TRADES.json");
  }

  const sellResults = results.filter((r) => r.step === "sell");
  const transferResult = results.find((r) => r.step === "transfer");
  const successfulSells = sellResults.filter((r) => r.success).length;
  const failedSells = sellResults.filter((r) => !r.success && !r.error?.includes("No balance")).length;

  return c.json({
    success: (transferResult?.success ?? true) && failedSells === 0,
    summary: {
      tokensFound: tokensToSell.length,
      tokensSold: successfulSells,
      tokensFailed: failedSells,
      monTransferred: transferResult?.success ?? false,
      transferHash: transferResult?.txHash ?? null,
    },
    results,
  });
});

export default instanceRoutes;
