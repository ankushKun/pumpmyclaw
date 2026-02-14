import { eq, inArray, and } from 'drizzle-orm';
import { tokenMetadata } from '../db/schema';
import type { Database } from '../db/client';
import type { Chain } from './blockchain/types';
import { ethers } from 'ethers';

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
      uncached.map((address) =>
        fetchTokenInfo(chain, address).then((info) => ({ address, info }))
      ),
    );

    const toUpsert: Array<{ chain: Chain; address: string; info: TokenInfo }> = [];
    for (const r of resolved) {
      if (r.status === 'fulfilled' && r.value.info) {
        const { address, info } = r.value;
        result.set(address, info);
        toUpsert.push({ chain, address, info });
      } else {
        const address = r.status === 'fulfilled' ? r.value.address : '';
        if (address) {
          const shortAddress = address.slice(0, 6) + '...' + address.slice(-4);
          const decimals = chain === 'solana' ? 6 : 18;
          result.set(address, {
            mint: address,
            address,
            chain,
            name: shortAddress,
            symbol: shortAddress,
            decimals,
            logoUrl: null
          });
        }
      }
    }

    // Batch upsert resolved tokens into DB cache
    for (const { chain, address, info } of toUpsert) {
      try {
        await db
          .insert(tokenMetadata)
          .values({
            chain,
            address,
            mint: address, // For backward compatibility
            name: info.name,
            symbol: info.symbol,
            decimals: info.decimals,
            logoUrl: info.logoUrl,
          })
          .onConflictDoUpdate({
            target: [tokenMetadata.chain, tokenMetadata.address],
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

async function fetchTokenInfo(chain: Chain, address: string): Promise<TokenInfo | null> {
  if (chain === 'solana') {
    return fetchSolanaTokenInfo(address);
  } else if (chain === 'monad') {
    return fetchMonadTokenInfo(address);
  }
  return null;
}

async function fetchSolanaTokenInfo(mint: string): Promise<TokenInfo | null> {
  // Try Pump.fun API (works well for .pump tokens)
  try {
    const res = await fetch(`${PUMPFUN_API}/coins/${mint}?sync=true`);
    if (res.ok) {
      const data: any = await res.json();
      if (data.name && data.symbol) {
        return {
          mint: data.mint ?? mint,
          address: data.mint ?? mint,
          chain: 'solana',
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
          address: data.address ?? mint,
          chain: 'solana',
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
            address: token.address ?? mint,
            chain: 'solana',
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

async function fetchMonadTokenInfo(address: string): Promise<TokenInfo | null> {
  // Try direct ERC-20 contract calls (most reliable for Monad tokens)
  try {
    // Use public Monad RPC endpoint
    const rpcUrl = 'https://monad-mainnet.g.alchemy.com/v2/lmvpGNblnJ3z4dq4w1Ki6';
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // ERC-20 ABI for name, symbol, decimals
    const erc20Abi = [
      'function name() view returns (string)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
    ];

    const contract = new ethers.Contract(address, erc20Abi, provider);

    // Fetch metadata in parallel
    const [name, symbol, decimals] = await Promise.all([
      contract.name().catch(() => null),
      contract.symbol().catch(() => null),
      contract.decimals().catch(() => 18),
    ]);

    if (name && symbol) {
      return {
        mint: address,
        address: address,
        chain: 'monad',
        name,
        symbol,
        decimals: Number(decimals),
        logoUrl: null,
      };
    }
  } catch (err) {
    console.error(`Failed to fetch ERC-20 metadata for ${address}:`, err);
  }

  // Fallback: Try DexScreener
  try {
    const res = await fetch(`${DEXSCREENER_API}/${address}`);
    if (res.ok) {
      const data: any = await res.json();
      const pairs = data.pairs;
      if (Array.isArray(pairs) && pairs.length > 0) {
        const token = pairs[0].baseToken;
        if (token && token.name && token.symbol) {
          return {
            mint: token.address ?? address,
            address: token.address ?? address,
            chain: 'monad',
            name: token.name,
            symbol: token.symbol,
            decimals: 18, // EVM default
            logoUrl: null,
          };
        }
      }
    }
  } catch {}

  return null;
}
