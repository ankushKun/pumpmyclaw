import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { Redis } from '@upstash/redis/cloudflare';
import { agents, tokenSnapshots } from '../db/schema';
import { DexChartClient } from '../services/dex-chart-client';
import type { HonoEnv } from '../types/hono';

export const chartRoutes = new Hono<HonoEnv>();

// GET /api/agents/:id/chart
chartRoutes.get('/:id/chart', async (c) => {
  const agentId = c.req.param('id');
  const timeframe = parseInt(c.req.query('timeframe') ?? '300');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100'), 500);
  const db = c.get('db');

  const agent = await db
    .select({ tokenMintAddress: agents.tokenMintAddress })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (agent.length === 0) {
    return c.json({ success: false, error: 'Agent not found' }, 404);
  }

  const mint = agent[0].tokenMintAddress;

  if (!mint) {
    return c.json({ success: true, data: [] });
  }

  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const cacheKey = `candlestick:${mint}:${timeframe}:${limit}`;
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
    return c.json({ success: true, data: parsed });
  }

  const dexClient = new DexChartClient();
  const candles = await dexClient.getCandlesticks(mint, timeframe, limit);

  if (candles.length > 0) {
    await redis.set(cacheKey, JSON.stringify(candles), { ex: 60 });
    return c.json({ success: true, data: candles });
  }

  // Fallback: build synthetic candles from token_snapshots
  const snapshots = await db
    .select({
      priceUsd: tokenSnapshots.priceUsd,
      snapshotAt: tokenSnapshots.snapshotAt,
    })
    .from(tokenSnapshots)
    .where(eq(tokenSnapshots.agentId, agentId))
    .orderBy(tokenSnapshots.snapshotAt)
    .limit(limit * 4);

  if (snapshots.length > 0) {
    const bucketSizeMs = timeframe * 1000;
    const buckets = new Map<number, number[]>();

    for (const s of snapshots) {
      const ts = new Date(s.snapshotAt).getTime();
      const bucketTime = Math.floor(ts / bucketSizeMs) * timeframe;
      if (!buckets.has(bucketTime)) buckets.set(bucketTime, []);
      buckets.get(bucketTime)!.push(parseFloat(s.priceUsd));
    }

    const syntheticCandles = Array.from(buckets.entries())
      .sort(([a], [b]) => a - b)
      .slice(-limit)
      .map(([time, prices]) => ({
        time,
        open: prices[0],
        high: Math.max(...prices),
        low: Math.min(...prices),
        close: prices[prices.length - 1],
      }));

    if (syntheticCandles.length > 0) {
      await redis.set(cacheKey, JSON.stringify(syntheticCandles), { ex: 60 });
      return c.json({ success: true, data: syntheticCandles });
    }
  }

  return c.json({ success: true, data: [] });
});

// GET /api/agents/:id/token-stats — live token price, market cap, volume from DexScreener
chartRoutes.get('/:id/token-stats', async (c) => {
  const agentId = c.req.param('id');
  const db = c.get('db');

  const agent = await db
    .select({ tokenMintAddress: agents.tokenMintAddress })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (agent.length === 0) {
    return c.json({ success: false, error: 'Agent not found' }, 404);
  }

  const mint = agent[0].tokenMintAddress;
  if (!mint) {
    return c.json({ success: true, data: null });
  }

  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const cacheKey = `token-stats:${mint}`;
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
    return c.json({ success: true, data: parsed });
  }

  const dexClient = new DexChartClient();
  const stats = await dexClient.getTokenStats(mint);

  if (stats) {
    await redis.set(cacheKey, JSON.stringify(stats), { ex: 30 });
  }

  return c.json({ success: true, data: stats });
});
