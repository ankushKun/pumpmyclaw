import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { trades, tradeAnnotations } from '../db/schema';
import { apiKeyAuth } from '../middleware/auth';
import { resolveTokens } from '../services/token-resolver';
import type { HonoEnv } from '../types/hono';

export const tradeRoutes = new Hono<HonoEnv>();

/** Enrich trade rows with token names/symbols */
async function enrichTrades(db: any, tradeRows: any[]) {
  if (tradeRows.length === 0) return tradeRows;
  const allMints = tradeRows.flatMap((t) => [t.tokenInMint, t.tokenOutMint]);
  const tokenMap = await resolveTokens(db, allMints);
  return tradeRows.map((t) => ({
    ...t,
    tokenInSymbol: tokenMap.get(t.tokenInMint)?.symbol ?? undefined,
    tokenInName: tokenMap.get(t.tokenInMint)?.name ?? undefined,
    tokenOutSymbol: tokenMap.get(t.tokenOutMint)?.symbol ?? undefined,
    tokenOutName: tokenMap.get(t.tokenOutMint)?.name ?? undefined,
  }));
}

// GET /api/trades/agent/:agentId
tradeRoutes.get('/agent/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const page = parseInt(c.req.query('page') ?? '1');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 100);
  const offset = (page - 1) * limit;
  const db = c.get('db');

  const agentTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.agentId, agentId))
    .orderBy(desc(trades.blockTime))
    .limit(limit)
    .offset(offset);

  const enriched = await enrichTrades(db, agentTrades);

  return c.json({
    success: true,
    data: enriched,
    meta: { page, limit },
  });
});

// GET /api/trades/agent/:agentId/buybacks
tradeRoutes.get('/agent/:agentId/buybacks', async (c) => {
  const agentId = c.req.param('agentId');
  const db = c.get('db');

  const buybacks = await db
    .select()
    .from(trades)
    .where(and(eq(trades.agentId, agentId), eq(trades.isBuyback, true)))
    .orderBy(desc(trades.blockTime));

  const enriched = await enrichTrades(db, buybacks);

  return c.json({ success: true, data: enriched });
});

// POST /api/trades/:txSignature/annotate (authed)
const annotateSchema = z.object({
  strategy: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

tradeRoutes.post(
  '/:txSignature/annotate',
  apiKeyAuth,
  zValidator('json', annotateSchema),
  async (c) => {
    const txSignature = c.req.param('txSignature');
    const agentId = c.get('agentId')!;
    const body = c.req.valid('json');
    const db = c.get('db');

    const trade = await db
      .select({ id: trades.id, agentId: trades.agentId })
      .from(trades)
      .where(eq(trades.txSignature, txSignature))
      .limit(1);

    if (trade.length === 0) {
      return c.json({ success: false, error: 'Trade not found' }, 404);
    }

    if (trade[0].agentId !== agentId) {
      return c.json(
        { success: false, error: 'Trade does not belong to this agent' },
        403,
      );
    }

    const [annotation] = await db
      .insert(tradeAnnotations)
      .values({
        tradeId: trade[0].id,
        agentId,
        strategy: body.strategy ?? null,
        notes: body.notes ?? null,
        tags: body.tags ?? null,
      })
      .returning();

    return c.json({ success: true, data: annotation }, 201);
  },
);
