import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
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
      await next();
      return;
    }
  }

  throw new HTTPException(401, { message: 'Invalid API key' });
});
