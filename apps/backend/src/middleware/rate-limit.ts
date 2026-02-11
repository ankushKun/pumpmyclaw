import type { Context, Next } from "hono";

/**
 * Simple in-memory rate limiter using sliding window algorithm.
 * For production, consider using Redis for distributed rate limiting.
 */

interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Key extractor - defaults to IP address */
  keyGenerator?: (c: Context) => string;
  /** Custom message when rate limited */
  message?: string;
}

interface RequestRecord {
  timestamps: number[];
}

const store = new Map<string, RequestRecord>();

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store) {
    // Remove timestamps older than 1 hour (cleanup threshold)
    record.timestamps = record.timestamps.filter(
      (ts) => now - ts < 60 * 60 * 1000
    );
    if (record.timestamps.length === 0) {
      store.delete(key);
    }
  }
}, 60 * 1000); // Run every minute

/**
 * Rate limiting middleware factory.
 */
/**
 * Default IP extraction strategy:
 * 1. x-real-ip — set by nginx via `proxy_set_header X-Real-IP $remote_addr`
 *    (not spoofable when nginx is the only reverse proxy)
 * 2. Last IP in x-forwarded-for — the one appended by nginx, not the client
 * 3. Fallback to a per-request random key so unknown clients never share a bucket
 */
function defaultKeyGenerator(c: Context): string {
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim());
    // Last entry is the one added by the closest reverse proxy (nginx)
    const lastIp = parts[parts.length - 1];
    if (lastIp) return lastIp;
  }

  // No proxy headers at all — generate a unique key per request
  // so unknown clients don't share a single rate-limit bucket
  return `no-ip-${crypto.randomUUID()}`;
}

export function rateLimit(config: RateLimitConfig) {
  const {
    max,
    windowMs,
    keyGenerator = defaultKeyGenerator,
    message = "Too many requests, please try again later",
  } = config;

  return async (c: Context, next: Next) => {
    const key = keyGenerator(c);
    const now = Date.now();

    // Get or create record for this key
    let record = store.get(key);
    if (!record) {
      record = { timestamps: [] };
      store.set(key, record);
    }

    // Remove timestamps outside the current window
    record.timestamps = record.timestamps.filter(
      (ts) => now - ts < windowMs
    );

    // Check if rate limit exceeded
    if (record.timestamps.length >= max) {
      const oldestRequest = record.timestamps[0];
      const resetTime = oldestRequest + windowMs;
      const retryAfter = Math.ceil((resetTime - now) / 1000);

      c.header("X-RateLimit-Limit", String(max));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(Math.ceil(resetTime / 1000)));
      c.header("Retry-After", String(retryAfter));

      return c.json({ error: message }, 429);
    }

    // Add current request timestamp
    record.timestamps.push(now);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(max - record.timestamps.length));
    c.header(
      "X-RateLimit-Reset",
      String(Math.ceil((record.timestamps[0] + windowMs) / 1000))
    );

    await next();
  };
}

/**
 * Preset: General API rate limit (100 requests per minute)
 */
export const generalRateLimit = rateLimit({
  max: 100,
  windowMs: 60 * 1000, // 1 minute
});

/**
 * Preset: Auth endpoint rate limit (10 requests per minute)
 */
export const authRateLimit = rateLimit({
  max: 10,
  windowMs: 60 * 1000,
  message: "Too many authentication attempts, please try again later",
});

/**
 * Preset: Instance creation rate limit (20 per hour)
 */
export const instanceCreationRateLimit = rateLimit({
  max: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
  message: "Too many instance creation attempts, please try again later",
});
