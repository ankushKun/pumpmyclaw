import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { Redis } from '@upstash/redis/cloudflare';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { agents } from '../db/schema';
import type { HonoEnv } from '../types/hono';

/**
 * Compute a hex SHA-256 hash of the API key.
 * Used as a fast lookup prefix to avoid O(N) bcrypt comparison.
 */
async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const apiKeyAuth = createMiddleware<HonoEnv>(async (c, next) => {
  const apiKey = c.req.header('X-API-Key');
  if (!apiKey) {
    throw new HTTPException(401, { message: 'Missing X-API-Key header' });
  }

  const db = c.get('db');

  // Compute SHA-256 hash of the provided API key for fast lookup
  const apiKeyPrefix = await sha256Hex(apiKey);

  // Try fast path: look up by apiKeyPrefix (if agents have it stored)
  const agentsByPrefix = await db.select({
    id: agents.id,
    apiKeyHash: agents.apiKeyHash,
    apiKeyPrefix: agents.apiKeyPrefix,
  }).from(agents).where(eq(agents.apiKeyPrefix, apiKeyPrefix)).limit(1);

  if (agentsByPrefix.length > 0) {
    const agent = agentsByPrefix[0];
    // Verify with bcrypt (single comparison, O(1))
    const matches = await bcrypt.compare(apiKey, agent.apiKeyHash);
    if (matches) {
      c.set('agentId', agent.id);

      // Track agent activity for cron polling decisions (fire-and-forget)
      c.executionCtx.waitUntil(
        new Redis({
          url: c.env.UPSTASH_REDIS_REST_URL,
          token: c.env.UPSTASH_REDIS_REST_TOKEN,
        }).set(`agent_activity:${agent.id}`, Date.now().toString(), { ex: 86400 })
          .catch(() => {}) // non-fatal
      );

      await next();
      return;
    }
  }

  // Slow fallback: scan all agents (for agents without apiKeyPrefix set yet)
  // This handles backward compatibility during migration
  const allAgents = await db.select({
    id: agents.id,
    apiKeyHash: agents.apiKeyHash,
    apiKeyPrefix: agents.apiKeyPrefix,
  }).from(agents);

  for (const agent of allAgents) {
    // Skip agents we already checked via prefix
    if (agent.apiKeyPrefix === apiKeyPrefix) continue;

    const matches = await bcrypt.compare(apiKey, agent.apiKeyHash);
    if (matches) {
      // Backfill the apiKeyPrefix for future fast lookups
      try {
        await db.update(agents)
          .set({ apiKeyPrefix: apiKeyPrefix })
          .where(eq(agents.id, agent.id));
      } catch {
        // Non-fatal: prefix backfill failure doesn't block auth
      }

      c.set('agentId', agent.id);

      // Track agent activity
      c.executionCtx.waitUntil(
        new Redis({
          url: c.env.UPSTASH_REDIS_REST_URL,
          token: c.env.UPSTASH_REDIS_REST_TOKEN,
        }).set(`agent_activity:${agent.id}`, Date.now().toString(), { ex: 86400 })
          .catch(() => {})
      );

      await next();
      return;
    }
  }

  throw new HTTPException(401, { message: 'Invalid API key' });
});
