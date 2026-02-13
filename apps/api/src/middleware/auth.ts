import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { Redis } from '@upstash/redis/cloudflare';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { agents } from '../db/schema';
import type { HonoEnv } from '../types/hono';

export const apiKeyAuth = createMiddleware<HonoEnv>(async (c, next) => {
  const apiKey = c.req.header('X-API-Key');
  if (!apiKey) {
    throw new HTTPException(401, { message: 'Missing X-API-Key header' });
  }

  const db = c.get('db');

  const allAgents = await db.select({
    id: agents.id,
    apiKeyHash: agents.apiKeyHash,
  }).from(agents);

  for (const agent of allAgents) {
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

  throw new HTTPException(401, { message: 'Invalid API key' });
});
