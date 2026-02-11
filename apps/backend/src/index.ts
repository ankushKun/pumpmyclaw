import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { eq } from "drizzle-orm";
import authRoutes from "./routes/auth";
import instanceRoutes from "./routes/instances";
import { verifyToken } from "./services/jwt";
import { generalRateLimit, authRateLimit } from "./middleware/rate-limit";
import { ensureImageReady } from "./services/docker";
import { db } from "./db";
import { users } from "./db/schema";

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

console.log(`[pmc-backend] Listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  // Increase idle timeout for SSE log streaming (default is 10s)
  idleTimeout: 250,
};
