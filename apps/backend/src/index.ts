import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { eq, sql } from "drizzle-orm";
import authRoutes from "./routes/auth";
import instanceRoutes from "./routes/instances";
import { subscriptionRoutes, webhookRoutes } from "./routes/subscriptions";
import { verifyToken } from "./services/jwt";
import { generalRateLimit, authRateLimit } from "./middleware/rate-limit";
import { ensureImageReady } from "./services/docker";
import { startSubscriptionEnforcer } from "./services/subscription-enforcer";
import { startDbAdmin } from "./db-admin";
import { db } from "./db";
import { users, subscriptions } from "./db/schema";

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
