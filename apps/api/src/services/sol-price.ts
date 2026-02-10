import { Redis } from '@upstash/redis/cloudflare';
import type { Env } from '../types/env';

const SOL_PRICE_CACHE_KEY = 'sol_price_usd';
const SOL_PRICE_TTL = 60; // 1 minute

// Pyth SOL/USD price feed ID
const PYTH_SOL_FEED = '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';

/**
 * Resilient SOL price fetcher with multiple fallback sources.
 * Tries each source in order, caches successful result in Redis.
 * Sources: CoinGecko → Raydium → Pyth → Pump.fun → Stale cache
 */
export async function getSolPriceUsd(env: Env): Promise<number> {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Check cache first
  const cached = await redis.get<string>(SOL_PRICE_CACHE_KEY);
  if (cached) {
    const price = parseFloat(cached);
    if (price > 0) return price;
  }

  // Try each source in order of reliability (verified working from CF Workers)
  const sources: Array<{ name: string; fetch: () => Promise<number> }> = [
    { name: 'CoinGecko', fetch: fetchFromCoinGecko },
    { name: 'Raydium', fetch: fetchFromRaydium },
    { name: 'Pyth', fetch: fetchFromPyth },
    { name: 'PumpFun', fetch: fetchFromPumpFun },
  ];

  for (const source of sources) {
    try {
      const price = await source.fetch();
      if (price > 0) {
        // Cache with TTL + persist as last-known (no expiry)
        await redis.set(SOL_PRICE_CACHE_KEY, price.toString(), {
          ex: SOL_PRICE_TTL,
        });
        await redis.set('sol_price_usd_last_known', price.toString());
        return price;
      }
    } catch (err) {
      console.warn(`SOL price source ${source.name} failed:`, err);
    }
  }

  // Last resort: stale cache (no TTL — better than $0)
  const stale = await redis.get<string>('sol_price_usd_last_known');
  if (stale) {
    const price = parseFloat(stale);
    if (price > 0) {
      console.warn(`Using stale SOL price: $${price}`);
      return price;
    }
  }

  console.error('All SOL price sources failed and no cached price available');
  return 0;
}

/** CoinGecko free API — reliable, occasionally rate-limited */
async function fetchFromCoinGecko(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return 0;
  const data: any = await res.json();
  return data.solana?.usd ?? 0;
}

/** Raydium price API — returns SOL price by mint */
async function fetchFromRaydium(): Promise<number> {
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const res = await fetch('https://api.raydium.io/v2/main/price', {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return 0;
  const data: any = await res.json();
  const price = data[SOL_MINT];
  return typeof price === 'number' ? price : 0;
}

/** Pyth Network oracle — decentralized, always available */
async function fetchFromPyth(): Promise<number> {
  const res = await fetch(
    `https://hermes.pyth.network/api/latest_price_feeds?ids[]=${PYTH_SOL_FEED}`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return 0;
  const data: any = await res.json();
  const feed = data[0];
  if (!feed?.price?.price || !feed?.price?.expo) return 0;
  return parseFloat(feed.price.price) * Math.pow(10, feed.price.expo);
}

/** Pump.fun SOL price — unreliable, last resort */
async function fetchFromPumpFun(): Promise<number> {
  const res = await fetch('https://frontend-api.pump.fun/sol-price', {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return 0;
  const data: any = await res.json();
  return data.solPrice ?? 0;
}
