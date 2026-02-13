/**
 * Multi-chain base asset price service
 *
 * Provides unified price fetching for chain-native assets (SOL, MON, etc.)
 */

import type { Chain } from './blockchain/types';
import { getSolPriceUsd } from './sol-price';
import { Redis } from '@upstash/redis';

interface Env {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
}

/**
 * Get base asset price for any chain
 */
export async function getBaseAssetPriceUsd(
  chain: Chain,
  env: Env,
): Promise<number> {
  switch (chain) {
    case 'solana':
      return getSolPriceUsd(env);
    case 'monad':
      return getMonPriceUsd(env);
    default:
      console.error(`Unknown chain: ${chain}`);
      return 0;
  }
}

/**
 * Get MON (Monad native token) price in USD
 *
 * Cascade strategy:
 * 1. CoinGecko (primary)
 * 2. DexScreener (WMON pairs)
 * 3. GeckoTerminal (backup)
 * 4. Stale cache (last known good price)
 */
export async function getMonPriceUsd(env: Env): Promise<number> {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  const cacheKey = 'mon_price_usd';
  const staleKey = 'mon_price_usd_last_known';

  // Try cache first (60s TTL)
  const cached = await redis.get<string>(cacheKey);
  if (cached) {
    const price = parseFloat(cached);
    if (price > 0) {
      return price;
    }
  }

  // Cascade through price sources
  const sources = [
    { name: 'CoinGecko', fetch: fetchMonFromCoinGecko },
    { name: 'DexScreener', fetch: fetchMonFromDexScreener },
    { name: 'GeckoTerminal', fetch: fetchMonFromGeckoTerminal },
  ];

  for (const source of sources) {
    try {
      const price = await source.fetch();
      if (price > 0) {
        console.log(`MON price from ${source.name}: $${price}`);

        // Cache for 60 seconds
        await redis.set(cacheKey, price.toString(), { ex: 60 });

        // Store as last known good price (no expiry)
        await redis.set(staleKey, price.toString());

        return price;
      }
    } catch (err) {
      console.warn(`MON price source ${source.name} failed:`, err);
      continue;
    }
  }

  // Last resort: stale cache
  console.warn('All MON price sources failed, trying stale cache...');
  const stale = await redis.get<string>(staleKey);
  if (stale) {
    const price = parseFloat(stale);
    if (price > 0) {
      console.warn(`Using stale MON price: $${price}`);
      return price;
    }
  }

  console.error('MON price completely unavailable');
  return 0;
}

/**
 * Fetch MON price from CoinGecko API
 */
async function fetchMonFromCoinGecko(): Promise<number> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd',
    {
      signal: AbortSignal.timeout(5000),
      headers: {
        'Accept': 'application/json',
      },
    }
  );

  if (!res.ok) {
    throw new Error(`CoinGecko API failed: ${res.status}`);
  }

  const data: any = await res.json();
  return data.monad?.usd ?? 0;
}

/**
 * Fetch MON price from DexScreener (WMON pairs)
 */
async function fetchMonFromDexScreener(): Promise<number> {
  const WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';

  const res = await fetch(
    `https://api.dexscreener.com/latest/dex/tokens/${WMON_ADDRESS}`,
    {
      signal: AbortSignal.timeout(5000),
      headers: {
        'Accept': 'application/json',
      },
    }
  );

  if (!res.ok) {
    throw new Error(`DexScreener API failed: ${res.status}`);
  }

  const data: any = await res.json();
  const pairs = data.pairs ?? [];

  if (pairs.length === 0) {
    throw new Error('No WMON pairs found on DexScreener');
  }

  // Use the most liquid pair (first one is usually highest volume)
  const price = parseFloat(pairs[0].priceUsd ?? '0');
  if (price <= 0) {
    throw new Error('Invalid price from DexScreener');
  }

  return price;
}

/**
 * Fetch MON price from GeckoTerminal
 */
async function fetchMonFromGeckoTerminal(): Promise<number> {
  const WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';

  // GeckoTerminal requires network ID + token address
  // Assuming Monad network is supported (may need to verify)
  const res = await fetch(
    `https://api.geckoterminal.com/api/v2/simple/networks/monad/token_price/${WMON_ADDRESS}`,
    {
      signal: AbortSignal.timeout(5000),
      headers: {
        'Accept': 'application/json',
      },
    }
  );

  if (!res.ok) {
    throw new Error(`GeckoTerminal API failed: ${res.status}`);
  }

  const data: any = await res.json();
  const priceData = data.data?.attributes?.token_prices?.[WMON_ADDRESS.toLowerCase()];

  if (!priceData) {
    throw new Error('No price data from GeckoTerminal');
  }

  const price = parseFloat(priceData);
  if (price <= 0) {
    throw new Error('Invalid price from GeckoTerminal');
  }

  return price;
}
