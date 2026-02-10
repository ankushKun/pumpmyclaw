import { eq } from 'drizzle-orm';
import { tokenMetadata } from '../db/schema';
import type { Database } from '../db/client';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PUMPFUN_API = 'https://frontend-api.pump.fun';
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

export interface TokenInfo {
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl: string | null;
}

const SOL_INFO: TokenInfo = {
  mint: SOL_MINT,
  name: 'Solana',
  symbol: 'SOL',
  decimals: 9,
  logoUrl: null,
};

/** Check if a cached entry is just a truncated address fallback */
function isFallbackEntry(info: TokenInfo): boolean {
  return info.symbol.includes('...');
}

/**
 * Resolves token metadata for a set of mints. Uses DB cache first,
 * then falls back to Pump.fun → Jupiter → DexScreener APIs.
 * Returns a Map of mint → TokenInfo.
 */
export async function resolveTokens(
  db: Database,
  mints: string[],
): Promise<Map<string, TokenInfo>> {
  const uniqueMints = [...new Set(mints)];
  const result = new Map<string, TokenInfo>();

  // SOL is always known
  result.set(SOL_MINT, SOL_INFO);

  const toResolve = uniqueMints.filter((m) => m !== SOL_MINT);
  if (toResolve.length === 0) return result;

  // Check DB cache
  const cachedMap = new Map<string, TokenInfo>();
  for (const mint of toResolve) {
    const rows = await db
      .select()
      .from(tokenMetadata)
      .where(eq(tokenMetadata.mint, mint))
      .limit(1);
    if (rows.length > 0) {
      const r = rows[0];
      cachedMap.set(mint, {
        mint: r.mint,
        name: r.name,
        symbol: r.symbol,
        decimals: r.decimals,
        logoUrl: r.logoUrl,
      });
    }
  }

  for (const [mint, info] of cachedMap) {
    // Skip fallback entries — try to re-resolve them
    if (!isFallbackEntry(info)) {
      result.set(mint, info);
    }
  }

  // Resolve uncached or fallback-cached mints via APIs
  const uncached = toResolve.filter((m) => !result.has(m));
  for (const mint of uncached) {
    const info = await fetchTokenInfo(mint);
    if (info) {
      result.set(mint, info);
      // Upsert in DB cache (overwrite stale fallback entries)
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
    } else {
      // Use truncated address as display fallback (don't cache it)
      const shortMint = mint.slice(0, 6) + '...' + mint.slice(-4);
      result.set(mint, {
        mint,
        name: shortMint,
        symbol: shortMint,
        decimals: 6,
        logoUrl: null,
      });
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
