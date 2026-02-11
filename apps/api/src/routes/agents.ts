import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { agents, agentContext } from '../db/schema';
import { apiKeyAuth } from '../middleware/auth';
import { HeliusClient } from '../services/helius-client';
import { ingestTradesForAgent } from '../services/trade-ingester';
import { recalculateRankings } from '../cron/ranking-calculator';
import type { HonoEnv } from '../types/hono';

export const agentRoutes = new Hono<HonoEnv>();

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional(),
  walletAddress: z.string().min(32).max(44),
  tokenMintAddress: z.string().min(32).max(44).optional(),
});

const contextSchema = z.object({
  contextType: z.enum(['target_price', 'stop_loss', 'portfolio_update', 'strategy_update']),
  data: z.record(z.unknown()),
});

// POST /api/agents/register
agentRoutes.post(
  '/register',
  zValidator('json', registerSchema),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');

    const existing = await db.select({ id: agents.id })
      .from(agents)
      .where(eq(agents.walletAddress, body.walletAddress))
      .limit(1);

    if (existing.length > 0) {
      return c.json({ success: false, error: 'Wallet already registered' }, 409);
    }

    const rawApiKey = `pmc_${crypto.randomUUID().replace(/-/g, '')}`;
    const apiKeyHash = await bcrypt.hash(rawApiKey, 10);

    const [newAgent] = await db.insert(agents).values({
      name: body.name,
      bio: body.bio ?? null,
      avatarUrl: body.avatarUrl ?? null,
      walletAddress: body.walletAddress,
      tokenMintAddress: body.tokenMintAddress ?? null,
      apiKeyHash,
    }).returning({ id: agents.id });

    // Register wallet with Helius webhook
    const helius = new HeliusClient(c.env.HELIUS_API_KEY);
    try {
      await helius.addWalletToWebhook(
        body.walletAddress,
        c.env.HELIUS_WEBHOOK_SECRET,
      );
    } catch (err) {
      console.error('Failed to register wallet with Helius webhook:', err);
    }

    // Background: immediately backfill recent trade history
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const result = await ingestTradesForAgent(db, helius, c.env, {
            id: newAgent.id,
            walletAddress: body.walletAddress,
            tokenMintAddress: body.tokenMintAddress ?? null,
            name: body.name,
          }, {
            limit: 200,
            broadcast: true,
          });
          console.log(
            `Registration backfill: ${result.inserted} trades for ${body.name}`,
          );

          // Recalculate rankings with the new trades
          if (result.inserted > 0) {
            await recalculateRankings(c.env);
          }
        } catch (err) {
          console.error('Registration backfill failed:', err);
        }
      })(),
    );

    return c.json({
      success: true,
      data: {
        agentId: newAgent.id,
        apiKey: rawApiKey,
      },
    }, 201);
  },
);

// POST /api/agents/:id/sync (authed)
agentRoutes.post(
  '/:id/sync',
  apiKeyAuth,
  async (c) => {
    const agentId = c.req.param('id');
    const authedAgentId = c.get('agentId')!;
    const db = c.get('db');

    if (agentId !== authedAgentId) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    const agent = await db.select({
      id: agents.id,
      walletAddress: agents.walletAddress,
      tokenMintAddress: agents.tokenMintAddress,
      name: agents.name,
    }).from(agents).where(eq(agents.id, agentId)).limit(1);

    if (agent.length === 0) {
      return c.json({ success: false, error: 'Agent not found' }, 404);
    }

    const helius = new HeliusClient(c.env.HELIUS_API_KEY);
    const result = await ingestTradesForAgent(db, helius, c.env, agent[0], {
      limit: 100,
      broadcast: true,
    });

    // Recalculate rankings in background
    if (result.inserted > 0) {
      c.executionCtx.waitUntil(recalculateRankings(c.env));
    }

    return c.json({
      success: true,
      data: {
        inserted: result.inserted,
        total: result.total,
        signatures: result.signatures,
      },
    });
  },
);

// POST /api/agents/:id/resync — public resync trigger (rate-limited by CF)
agentRoutes.post('/:id/resync', async (c) => {
  const agentId = c.req.param('id');
  const db = c.get('db');

  const agent = await db.select({
    id: agents.id,
    walletAddress: agents.walletAddress,
    tokenMintAddress: agents.tokenMintAddress,
    name: agents.name,
  }).from(agents).where(eq(agents.id, agentId)).limit(1);

  if (agent.length === 0) {
    return c.json({ success: false, error: 'Agent not found' }, 404);
  }

  const helius = new HeliusClient(c.env.HELIUS_API_KEY);
  const result = await ingestTradesForAgent(db, helius, c.env, agent[0], {
    limit: 200,
    broadcast: true,
  });

  // Recalculate rankings in background
  if (result.inserted > 0) {
    c.executionCtx.waitUntil(recalculateRankings(c.env));
  }

  return c.json({
    success: true,
    data: {
      inserted: result.inserted,
      total: result.total,
      signatures: result.signatures,
    },
  });
});

// GET /api/agents
agentRoutes.get('/', async (c) => {
  const db = c.get('db');
  const allAgents = await db.select({
    id: agents.id,
    name: agents.name,
    bio: agents.bio,
    avatarUrl: agents.avatarUrl,
    walletAddress: agents.walletAddress,
    tokenMintAddress: agents.tokenMintAddress,
    createdAt: agents.createdAt,
  }).from(agents);

  return c.json({ success: true, data: allAgents });
});

// GET /api/agents/:id/context (must be before /:id to avoid param capture)
agentRoutes.get('/:id/context', async (c) => {
  const agentId = c.req.param('id');
  const db = c.get('db');

  const contexts = await db
    .select()
    .from(agentContext)
    .where(eq(agentContext.agentId, agentId))
    .orderBy(desc(agentContext.createdAt))
    .limit(20);

  return c.json({ success: true, data: contexts });
});

// GET /api/agents/:id
agentRoutes.get('/:id', async (c) => {
  const agentId = c.req.param('id');
  const db = c.get('db');

  const agent = await db.select({
    id: agents.id,
    name: agents.name,
    bio: agents.bio,
    avatarUrl: agents.avatarUrl,
    walletAddress: agents.walletAddress,
    tokenMintAddress: agents.tokenMintAddress,
    createdAt: agents.createdAt,
    updatedAt: agents.updatedAt,
  }).from(agents).where(eq(agents.id, agentId)).limit(1);

  if (agent.length === 0) {
    return c.json({ success: false, error: 'Agent not found' }, 404);
  }

  return c.json({ success: true, data: agent[0] });
});

// POST /api/agents/context (authed)
agentRoutes.post(
  '/context',
  apiKeyAuth,
  zValidator('json', contextSchema),
  async (c) => {
    const agentId = c.get('agentId')!;
    const body = c.req.valid('json');
    const db = c.get('db');

    const [ctx] = await db.insert(agentContext).values({
      agentId,
      contextType: body.contextType,
      data: body.data,
    }).returning();

    return c.json({ success: true, data: ctx }, 201);
  },
);
