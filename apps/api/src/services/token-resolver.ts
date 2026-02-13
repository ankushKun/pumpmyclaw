import { eq, inArray, and } from 'drizzle-orm';
import { tokenMetadata } from '../db/schema';
import type { Database } from '../db/client';
import type { Chain } from './blockchain/types';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const WMON_ADDRESS = '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A';
const PUMPFUN_API = 'https://frontend-api.pump.fun';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

export interface TokenInfo {
  mint: string; // DEPRECATED: use address
  address?: string; // NEW: chain-agnostic
  chain?: Chain; // NEW: chain identifier
  name: string;
  symbol: string;
  decimals: number;
  logoUrl: string | null;
}

const SOL_INFO: TokenInfo = {
  mint: SOL_MINT,
  address: SOL_MINT,
  chain: 'solana',
  name: 'Solana',
  symbol: 'SOL',
  decimals: 9,
  logoUrl: null,
};

const WMON_INFO: TokenInfo = {
  mint: WMON_ADDRESS, // For backward compatibility
  address: WMON_ADDRESS,
  chain: 'monad',
  name: 'Wrapped Monad',
  symbol: 'WMON',
  decimals: 18,
  logoUrl: null,
};

/** Check if a cached entry is just a truncated address fallback */
function isFallbackEntry(info: TokenInfo): boolean {
  return info.symbol.includes('...');
}

/**
 * Resolves token metadata for a set of addresses on a specific chain.
 * Uses DB cache first, then falls back to chain-specific APIs.
 * Returns a Map of address → TokenInfo.
 */
export async function resolveTokens(
  db: Database,
  chain: Chain,
  addresses: string[],
): Promise<Map<string, TokenInfo>> {
  const uniqueAddresses = [...new Set(addresses)];
  const result = new Map<string, TokenInfo>();

  // Native tokens are always known
  if (chain === 'solana') {
    result.set(SOL_MINT, SOL_INFO);
  } else if (chain === 'monad') {
    result.set(WMON_ADDRESS, WMON_INFO);
  }

  const toResolve = uniqueAddresses.filter((addr) => !result.has(addr));
  if (toResolve.length === 0) return result;

  // Check DB cache — single batch query (filter by chain + address)
  const cachedMap = new Map<string, TokenInfo>();
  if (toResolve.length > 0) {
    const rows = await db
      .select()
      .from(tokenMetadata)
      .where(
        and(
          eq(tokenMetadata.chain, chain),
          inArray(tokenMetadata.address, toResolve)
        )
      );
    for (const r of rows) {
      cachedMap.set(r.address, {
        mint: r.address, // For backward compatibility
        address: r.address,
        chain,
        name: r.name,
        symbol: r.symbol,
        decimals: r.decimals,
        logoUrl: r.logoUrl,
      });
    }
  }

  for (const [address, info] of cachedMap) {
    // Skip fallback entries — try to re-resolve them
    if (!isFallbackEntry(info)) {
      result.set(address, info);
    }
  }

  // Resolve uncached or fallback-cached addresses via APIs — in parallel
  const uncached = toResolve.filter((addr) => !result.has(addr));
  if (uncached.length > 0) {
    const resolved = await Promise.allSettled(
      uncached.map((mint) => fetchTokenInfo(mint).then((info) => ({ mint, info }))),
    );

    const toUpsert: TokenInfo[] = [];
    for (const r of resolved) {
      if (r.status === 'fulfilled' && r.value.info) {
        const { mint, info } = r.value;
        result.set(mint, info);
        toUpsert.push(info);
      } else {
        const mint = r.status === 'fulfilled' ? r.value.mint : '';
        if (mint) {
          const shortMint = mint.slice(0, 6) + '...' + mint.slice(-4);
          result.set(mint, { mint, name: shortMint, symbol: shortMint, decimals: 6, logoUrl: null });
        }
      }
    }

    // Batch upsert resolved tokens into DB cache
    for (const info of toUpsert) {
      try {
        await db
          .insert(tokenMetadata)
          .values({
            mint: info.mint,
            name: info.name,
            symbol: info.symbol,
            decimals: info.decimals,
            logoUrl: info.logoUrl,
          })
          .onConflictDoUpdate({
            target: tokenMetadata.mint,
            set: {
              name: info.name,
              symbol: info.symbol,
              decimals: info.decimals,
              logoUrl: info.logoUrl,
            },
          });
      } catch {
        // Ignore cache write failures
      }
    }
  }

  return result;
}

async function fetchTokenInfo(mint: string): Promise<TokenInfo | null> {
  // Try Pump.fun API (works well for .pump tokens)
  try {
    const res = await fetch(`${PUMPFUN_API}/coins/${mint}?sync=true`);
    if (res.ok) {
      const data: any = await res.json();
      if (data.name && data.symbol) {
        return {
          mint: data.mint ?? mint,
          name: data.name,
          symbol: data.symbol,
          decimals: data.decimals ?? 6,
          logoUrl: data.image_uri ?? null,
        };
      }
    }
  } catch {}

  // Fallback: try Jupiter token list
  try {
    const res = await fetch(`https://tokens.jup.ag/token/${mint}`);
    if (res.ok) {
      const data: any = await res.json();
      if (data.name && data.symbol) {
        return {
          mint: data.address ?? mint,
          name: data.name,
          symbol: data.symbol,
          decimals: data.decimals ?? 6,
          logoUrl: data.logoURI ?? null,
        };
      }
    }
  } catch {}

  // Fallback: try DexScreener
  try {
    const res = await fetch(`${DEXSCREENER_API}/${mint}`);
    if (res.ok) {
      const data: any = await res.json();
      const pairs = data.pairs;
      if (Array.isArray(pairs) && pairs.length > 0) {
        const token = pairs[0].baseToken;
        if (token && token.name && token.symbol) {
          return {
            mint: token.address ?? mint,
            name: token.name,
            symbol: token.symbol,
            decimals: 6,
            logoUrl: null,
          };
        }
      }
    }
  } catch {}

  return null;
}
