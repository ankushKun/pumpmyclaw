import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { eq, and, sql } from "drizzle-orm";
import authRoutes from "./routes/auth";
import instanceRoutes from "./routes/instances";
import { subscriptionRoutes, webhookRoutes } from "./routes/subscriptions";
import { verifyToken } from "./services/jwt";
import { generalRateLimit, authRateLimit } from "./middleware/rate-limit";
import { ensureImageReady, rollingUpdateAll } from "./services/docker";
import { decrypt } from "./services/crypto";
import { startSubscriptionEnforcer } from "./services/subscription-enforcer";
import { startDbAdmin } from "./db-admin";
import { db } from "./db";
import { users, instances, subscriptions } from "./db/schema";

// ── Startup env validation ─────────────────────────────────────────
const REQUIRED_ENV_VARS = [
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "TELEGRAM_BOT_TOKEN",
  "DODO_API_KEY",
  "DODO_WEBHOOK_KEY",
  "DODO_PRODUCT_ID",
  "FRONTEND_URL",
] as const;

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length === 0) return;

  const isProduction = process.env.NODE_ENV === "production";
  const label = isProduction ? "ERROR" : "WARN";
  const lines = missing.map((key) => `  - ${key}`).join("\n");

  console.error(
    `[pmc-backend] ${label}: Missing required environment variables:\n${lines}`
  );

  if (isProduction) {
    console.error(
      "[pmc-backend] Refusing to start in production with missing env vars."
    );
    process.exit(1);
  }
}

validateEnv();

type Variables = { userId: number };
const app = new Hono<{ Variables: Variables }>();

// ── Middleware ──────────────────────────────────────────────────────
app.use("*", logger());

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (process.env.NODE_ENV !== "production") return origin;
      return process.env.FRONTEND_URL || origin;
    },
    credentials: true,
  })
);

// ── Health check ───────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok", ts: Date.now() }));

// ── Rate limiting ──────────────────────────────────────────────────
// Apply stricter rate limiting to auth endpoints
app.use("/api/auth/*", authRateLimit);

// Apply general rate limiting to all API routes
app.use("/api/*", generalRateLimit);

// ── Auth routes (public) ───────────────────────────────────────────
app.route("/api/auth", authRoutes);

// ── Webhook routes (public — uses signature verification) ──────────
app.route("/api/webhooks", webhookRoutes);

// ── Public subscription info (no auth needed) ──────────────────────
app.get("/api/slots", async (c) => {
  const taken = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(sql`${subscriptions.status} IN ('active', 'pending')`);
  const takenCount = taken[0]?.count ?? 0;
  const TOTAL_SLOTS = 10;
  return c.json({
    total: TOTAL_SLOTS,
    taken: takenCount,
    remaining: Math.max(0, TOTAL_SLOTS - takenCount),
    soldOut: takenCount >= TOTAL_SLOTS,
  });
});

// ── Admin: grant subscription (uses DB_PASS for auth) ──────────────
app.post("/admin/grant-sub", async (c) => {
  const adminPass = process.env.DB_PASS;
  if (!adminPass) {
    return c.json({ error: "Admin not configured (set DB_PASS)" }, 503);
  }
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${adminPass}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  const identifier = body?.id || body?.telegramId;
  if (!identifier) {
    return c.json({ error: "Provide id or telegramId in body" }, 400);
  }

  // Find user by id or telegram_id
  let user = await db.query.users.findFirst({
    where: eq(users.id, Number(identifier)),
  });
  if (!user) {
    user = await db.query.users.findFirst({
      where: eq(users.telegramId, String(identifier)),
    });
  }
  if (!user) {
    return c.json({ error: `No user found matching "${identifier}"` }, 404);
  }

  // Check existing active subscription
  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.userId, user.id),
      eq(subscriptions.status, "active"),
    ),
  });
  if (existing) {
    return c.json({
      message: `User ${user.id} (@${user.username || user.firstName}) already has an active subscription`,
      subscription: existing,
    });
  }

  // Count taken slots
  const taken = await db
    .select({ count: sql<number>`count(*)` })
    .from(subscriptions)
    .where(sql`${subscriptions.status} IN ('active', 'pending')`);
  const slotNumber = (taken[0]?.count ?? 0) + 1;

  const now = new Date();
  const [sub] = await db
    .insert(subscriptions)
    .values({
      userId: user.id,
      dodoSubscriptionId: `manual_grant_${user.id}_${Math.floor(now.getTime() / 1000)}`,
      status: "active",
      slotNumber: Math.min(slotNumber, 10),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return c.json({
    message: `Granted subscription to user ${user.id} (@${user.username || user.firstName}), slot #${slotNumber}`,
    subscription: sub,
  });
});

// ── Admin: rolling update all containers ───────────────────────────
// Rebuilds the instance Docker image and recreates all running containers
// one at a time. Zero data loss — wallet, trades, token all preserved.
// Usage: curl -X POST http://localhost:8080/admin/update-all -H "Authorization: Bearer $DB_PASS"
app.post("/admin/update-all", async (c) => {
  const adminPass = process.env.DB_PASS;
  if (!adminPass) {
    return c.json({ error: "Admin not configured (set DB_PASS)" }, 503);
  }
  const authHeader = c.req.header("Authorization");
  if (authHeader !== `Bearer ${adminPass}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    const results = await rollingUpdateAll(async (containerId: string) => {
      // Look up the instance config from DB by containerId
      const instance = await db.query.instances.findFirst({
        where: eq(instances.containerId, containerId),
      });
      if (!instance) return null;

      const user = await db.query.users.findFirst({
        where: eq(users.id, instance.userId),
      });
      if (!user) return null;

      return {
        instanceId: instance.id,
        userId: user.id,
        telegramOwnerId: user.telegramId,
        telegramBotToken: decrypt(instance.telegramBotToken),
        openrouterApiKey: decrypt(instance.openrouterApiKey),
        model: instance.model || "openrouter/openrouter/auto",
      };
    });

    // Update DB with new container IDs
    for (const r of results) {
      if (r.status === "updated" && r.instanceId && r.newContainerId) {
        await db
          .update(instances)
          .set({ containerId: r.newContainerId, status: "pending", startedAt: new Date() })
          .where(eq(instances.id, r.instanceId));
      }
    }

    return c.json({
      message: `Rolling update complete`,
      results,
      summary: {
        total: results.length,
        updated: results.filter((r) => r.status === "updated").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin] Rolling update failed: ${msg}`);
    return c.json({ error: `Update failed: ${msg}` }, 500);
  }
});

// ── Auth middleware for all other /api routes ──────────────────────
app.use("/api/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized: Missing or invalid token" }, 401);
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix
  const payload = await verifyToken(token);

  if (!payload) {
    return c.json({ error: "Unauthorized: Invalid or expired token" }, 401);
  }

  // Verify user still exists in database (handles DB reset scenario)
  const user = await db.query.users.findFirst({
    where: eq(users.id, payload.userId),
  });

  if (!user) {
    return c.json({ error: "Unauthorized: User not found" }, 401);
  }

  c.set("userId", payload.userId);
  await next();
});

// ── Instance routes (protected) ───────────────────────────────────
app.route("/api/instances", instanceRoutes);

// ── Subscription routes (protected — checkout, status) ────────────
app.route("/api", subscriptionRoutes);

// ── Start server ──────────────────────────────────────────────────
const port = parseInt(process.env.PORT || "8080");

// Build Docker images before accepting requests.
// This runs at import-time so the server is ready when Bun starts serving.
console.log("[pmc-backend] Starting up...");
const startupStart = Date.now();

await ensureImageReady()
  .then(() => {
    const elapsed = ((Date.now() - startupStart) / 1000).toFixed(1);
    console.log(`[pmc-backend] Docker images ready (${elapsed}s)`);
  })
  .catch((err) => {
    console.error(`[pmc-backend] Docker image build failed: ${err.message}`);
    console.error("[pmc-backend] Instance creation will fail until images are available");
  });

// Start periodic subscription enforcer — stops containers when paid period ends
startSubscriptionEnforcer();

// Start DB Admin GUI if password is configured
if (process.env.DB_PASS) {
  startDbAdmin(process.env.DB_PASS);
} else {
  console.log("[pmc-backend] DB Admin disabled (set DB_PASS in .env to enable)");
}

console.log(`[pmc-backend] Listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  // Increase idle timeout for SSE log streaming (default is 10s)
  idleTimeout: 250,
};
