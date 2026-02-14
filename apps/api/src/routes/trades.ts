import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { trades, tradeAnnotations, agents } from '../db/schema';
import { apiKeyAuth } from '../middleware/auth';
import { resolveTokens } from '../services/token-resolver';
import type { HonoEnv } from '../types/hono';

export const tradeRoutes = new Hono<HonoEnv>();

/** Enrich trade rows with token names/symbols (best-effort, never fails the response) */
async function enrichTrades(db: any, tradeRows: any[]) {
  if (tradeRows.length === 0) return tradeRows;
  try {
    // Group trades by chain and resolve tokens per chain
    const chainGroups = new Map<string, any[]>();
    for (const trade of tradeRows) {
      const chain = trade.chain ?? 'solana'; // Default to solana for backward compatibility
      if (!chainGroups.has(chain)) {
        chainGroups.set(chain, []);
      }
      chainGroups.get(chain)!.push(trade);
    }

    // Resolve tokens for each chain — use chain:address key to avoid cross-chain collisions
    const allTokenMaps = new Map<string, any>();
    for (const [chain, chainTrades] of chainGroups) {
      const addresses = chainTrades.flatMap((t) => [
        t.tokenInAddress ?? t.tokenInMint,
        t.tokenOutAddress ?? t.tokenOutMint,
      ]);
      const tokenMap = await resolveTokens(db, chain as any, addresses);

      for (const [address, info] of tokenMap) {
        allTokenMaps.set(`${chain}:${address}`, info);
      }
    }

    // Enrich trades with resolved metadata
    return tradeRows.map((t) => {
      const chain = t.chain ?? 'solana';
      const tokenInAddr = t.tokenInAddress ?? t.tokenInMint;
      const tokenOutAddr = t.tokenOutAddress ?? t.tokenOutMint;

      return {
        ...t,
        tokenInSymbol: allTokenMaps.get(`${chain}:${tokenInAddr}`)?.symbol ?? undefined,
        tokenInName: allTokenMaps.get(`${chain}:${tokenInAddr}`)?.name ?? undefined,
        tokenOutSymbol: allTokenMaps.get(`${chain}:${tokenOutAddr}`)?.symbol ?? undefined,
        tokenOutName: allTokenMaps.get(`${chain}:${tokenOutAddr}`)?.name ?? undefined,
      };
    });
  } catch (err) {
    console.error('Token enrichment failed, returning raw trades:', err);
    return tradeRows;
  }
}

// GET /api/trades/recent — latest trades across all agents (for live feed backfill)
tradeRoutes.get('/recent', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20') || 20, 50);
  const db = c.get('db');

  const rows = await db
    .select({
      id: trades.id,
      agentId: trades.agentId,
      agentName: agents.name,
      chain: trades.chain,
      txSignature: trades.txSignature,
      blockTime: trades.blockTime,
      platform: trades.platform,
      tradeType: trades.tradeType,
      tokenInMint: trades.tokenInMint,
      tokenInAddress: trades.tokenInAddress,
      tokenInAmount: trades.tokenInAmount,
      tokenOutMint: trades.tokenOutMint,
      tokenOutAddress: trades.tokenOutAddress,
      tokenOutAmount: trades.tokenOutAmount,
      tradeValueUsd: trades.tradeValueUsd,
      isBuyback: trades.isBuyback,
    })
    .from(trades)
    .innerJoin(agents, eq(trades.agentId, agents.id))
    .orderBy(desc(trades.blockTime))
    .limit(limit);

  const enriched = await enrichTrades(db, rows);

  return c.json({ success: true, data: enriched });
});

// GET /api/trades/agent/:agentId
tradeRoutes.get('/agent/:agentId', async (c) => {
  const agentId = c.req.param('agentId');
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1') || 1);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50') || 50, 100);
  const offset = (page - 1) * limit;
  const chain = c.req.query('chain'); // Get optional chain filter
  const db = c.get('db');

  // Build WHERE clause with optional chain filter
  const whereConditions = [eq(trades.agentId, agentId)];
  if (chain) {
    whereConditions.push(eq(trades.chain, chain));
  }

  const agentTrades = await db
    .select()
    .from(trades)
    .where(and(...whereConditions))
    .orderBy(desc(trades.blockTime))
    .limit(limit)
    .offset(offset);

  const enriched = await enrichTrades(db, agentTrades);

  return c.json({
    success: true,
    data: enriched,
    meta: { page, limit, chain },
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
    .orderBy(desc(trades.blockTime))
    .limit(100);

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
