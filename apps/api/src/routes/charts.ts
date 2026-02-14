import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { Redis } from '@upstash/redis/cloudflare';
import { agents, tokenSnapshots, agentWallets, trades } from '../db/schema';
import { DexChartClient, type Chain } from '../services/dex-chart-client';
import type { HonoEnv } from '../types/hono';

export const chartRoutes = new Hono<HonoEnv>();

// GET /api/agents/:id/chart?chain=solana|monad
chartRoutes.get('/:id/chart', async (c) => {
  const agentId = c.req.param('id');
  const timeframe = parseInt(c.req.query('timeframe') ?? '300');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100'), 500);
  const chain = (c.req.query('chain') ?? 'solana') as Chain;
  const db = c.get('db');

  // Get token address from agent_wallets for the specific chain
  const walletResult = await db
    .select({ tokenAddress: agentWallets.tokenAddress })
    .from(agentWallets)
    .where(and(eq(agentWallets.agentId, agentId), eq(agentWallets.chain, chain)))
    .limit(1);

  if (walletResult.length === 0) {
    return c.json({ success: false, error: 'Agent wallet not found for this chain' }, 404);
  }

  const tokenAddress = walletResult[0].tokenAddress;

  if (!tokenAddress) {
    return c.json({ success: true, data: [] });
  }

  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const cacheKey = `candlestick:${chain}:${tokenAddress}:${timeframe}:${limit}`;
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
    return c.json({ success: true, data: parsed });
  }

  const dexClient = new DexChartClient();
  const candles = await dexClient.getCandlesticks(tokenAddress, timeframe, limit, chain);

  if (candles.length > 0) {
    await redis.set(cacheKey, JSON.stringify(candles), { ex: 60 });
    return c.json({ success: true, data: candles });
  }

  // Fallback 1: build synthetic candles from token_snapshots
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

  // Fallback 2: For Monad tokens, build candles from trade data
  // (DexScreener doesn't support Monad yet)
  if (chain === 'monad') {
    console.log(`[charts] Building synthetic candles from trades for Monad token ${tokenAddress}`);

    const recentTrades = await db
      .select({
        blockTime: trades.blockTime,
        tradeValueUsd: trades.tradeValueUsd,
        tokenOutAmount: trades.tokenOutAmount,
        tokenInAmount: trades.tokenInAmount,
        tokenOutAddress: trades.tokenOutAddress,
        baseAssetPriceUsd: trades.baseAssetPriceUsd,
      })
      .from(trades)
      .where(and(
        eq(trades.agentId, agentId),
        eq(trades.chain, chain)
      ))
      .orderBy(trades.blockTime)
      .limit(500);

    if (recentTrades.length > 0) {
      const bucketSizeMs = timeframe * 1000;
      const buckets = new Map<number, number[]>();

      for (const trade of recentTrades) {
        // Calculate token price from trade (tradeValueUsd / tokenAmount)
        let tokenPrice = 0;
        if (trade.tokenOutAddress === tokenAddress && parseFloat(trade.tokenOutAmount) > 0) {
          // They received this token (buy)
          tokenPrice = parseFloat(trade.tradeValueUsd) / (parseFloat(trade.tokenOutAmount) / 1e18);
        } else if (parseFloat(trade.tokenInAmount) > 0) {
          // They sent this token (sell)
          tokenPrice = parseFloat(trade.tradeValueUsd) / (parseFloat(trade.tokenInAmount) / 1e18);
        }

        if (tokenPrice > 0) {
          const ts = new Date(trade.blockTime).getTime();
          const bucketTime = Math.floor(ts / bucketSizeMs) * timeframe;
          if (!buckets.has(bucketTime)) buckets.set(bucketTime, []);
          buckets.get(bucketTime)!.push(tokenPrice);
        }
      }

      const tradeCandlesArray = Array.from(buckets.entries())
        .sort(([a], [b]) => a - b)
        .slice(-limit)
        .map(([time, prices]) => ({
          time,
          open: prices[0],
          high: Math.max(...prices),
          low: Math.min(...prices),
          close: prices[prices.length - 1],
          volume: prices.length,
        }));

      if (tradeCandlesArray.length > 0) {
        console.log(`[charts] Built ${tradeCandlesArray.length} candles from ${recentTrades.length} trades`);
        await redis.set(cacheKey, JSON.stringify(tradeCandlesArray), { ex: 60 });
        return c.json({ success: true, data: tradeCandlesArray });
      }
    }
  }

  return c.json({ success: true, data: [] });
});

// GET /api/agents/:id/token-stats?chain=solana|monad — live token price, market cap, volume from DexScreener
chartRoutes.get('/:id/token-stats', async (c) => {
  const agentId = c.req.param('id');
  const chain = (c.req.query('chain') ?? 'solana') as Chain;
  const db = c.get('db');

  // Get token address from agent_wallets for the specific chain
  const walletResult = await db
    .select({ tokenAddress: agentWallets.tokenAddress })
    .from(agentWallets)
    .where(and(eq(agentWallets.agentId, agentId), eq(agentWallets.chain, chain)))
    .limit(1);

  if (walletResult.length === 0) {
    return c.json({ success: false, error: 'Agent wallet not found for this chain' }, 404);
  }

  const tokenAddress = walletResult[0].tokenAddress;
  if (!tokenAddress) {
    return c.json({ success: true, data: null });
  }

  const redis = new Redis({
    url: c.env.UPSTASH_REDIS_REST_URL,
    token: c.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const cacheKey = `token-stats:${chain}:${tokenAddress}`;
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
    return c.json({ success: true, data: parsed });
  }

  const dexClient = new DexChartClient();
  const stats = await dexClient.getTokenStats(tokenAddress, chain);

  if (stats) {
    await redis.set(cacheKey, JSON.stringify(stats), { ex: 30 });
  }

  return c.json({ success: true, data: stats });
});
