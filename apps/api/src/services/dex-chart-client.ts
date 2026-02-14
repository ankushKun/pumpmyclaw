const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';

// GeckoTerminal network IDs
const GECKO_NETWORKS: Record<string, string> = {
  solana: 'solana',
  monad: 'monad', // GeckoTerminal network ID for Monad
};

// DexScreener chain IDs
const DEX_CHAIN_IDS: Record<string, string> = {
  solana: 'solana',
  monad: 'monad', // DexScreener chain ID for Monad
};

export type Chain = 'solana' | 'monad';

export interface TokenStats {
  priceUsd: string;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  priceChange1h: number | null;
  priceChange24h: number | null;
  symbol: string;
  name: string;
}

export interface CandlestickRaw {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class DexChartClient {
  /**
   * Fetch DexScreener pairs data for a token address. Reused by getPoolAddress and getTokenStats.
   */
  private async fetchPairs(tokenAddress: string, chain: Chain = 'solana'): Promise<any[] | null> {
    try {
      const res = await fetch(`${DEXSCREENER_API}/${tokenAddress}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;

      const data: any = await res.json();
      const pairs = data.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) return null;

      // Filter pairs by chain
      const chainId = DEX_CHAIN_IDS[chain];
      const filteredPairs = pairs.filter((p: any) => p.chainId === chainId);

      return filteredPairs.length > 0 ? filteredPairs : pairs;
    } catch (err) {
      console.error(`DexScreener fetchPairs failed for ${tokenAddress} on ${chain}:`, err);
      return null;
    }
  }

  /**
   * Resolve a token address to a pool address via DexScreener.
   */
  async getPoolAddress(tokenAddress: string, chain: Chain = 'solana'): Promise<string | null> {
    const pairs = await this.fetchPairs(tokenAddress, chain);
    if (!pairs) return null;

    const chainId = DEX_CHAIN_IDS[chain];
    const chainPair = pairs.find((p: any) => p.chainId === chainId);
    return chainPair?.pairAddress ?? pairs[0]?.pairAddress ?? null;
  }

  /**
   * Get live token stats (price, market cap, volume, liquidity, price changes) from DexScreener.
   */
  async getTokenStats(tokenAddress: string, chain: Chain = 'solana'): Promise<TokenStats | null> {
    const pairs = await this.fetchPairs(tokenAddress, chain);
    if (!pairs) return null;

    const chainId = DEX_CHAIN_IDS[chain];
    const p = pairs.find((pair: any) => pair.chainId === chainId) ?? pairs[0];

    if (!p) return null;

    return {
      priceUsd: p.priceUsd ?? '0',
      marketCap: p.marketCap ?? p.fdv ?? 0,
      liquidity: p.liquidity?.usd ?? 0,
      volume24h: p.volume?.h24 ?? 0,
      priceChange1h: p.priceChange?.h1 ?? null,
      priceChange24h: p.priceChange?.h24 ?? null,
      symbol: p.baseToken?.symbol ?? '',
      name: p.baseToken?.name ?? '',
    };
  }

  /**
   * Map timeframe in seconds to GeckoTerminal OHLCV path segment and aggregate param.
   */
  private mapTimeframe(seconds: number): { period: string; aggregate: number } {
    if (seconds >= 86400) return { period: 'day', aggregate: Math.max(1, Math.floor(seconds / 86400)) };
    if (seconds >= 3600) return { period: 'hour', aggregate: Math.max(1, Math.floor(seconds / 3600)) };
    return { period: 'minute', aggregate: Math.max(1, Math.floor(seconds / 60)) };
  }

  /**
   * Fetch OHLCV candlestick data via DexScreener (pool lookup) + GeckoTerminal (OHLCV).
   * Returns data in the same CandlestickRaw shape as the old PumpFunClient.
   */
  async getCandlesticks(
    tokenAddress: string,
    timeframe: number = 300,
    limit: number = 100,
    chain: Chain = 'solana',
  ): Promise<CandlestickRaw[]> {
    try {
      const poolAddress = await this.getPoolAddress(tokenAddress, chain);
      if (!poolAddress) {
        console.log(`[DexChartClient] No pool found for ${tokenAddress} on ${chain}`);
        return [];
      }

      const { period, aggregate } = this.mapTimeframe(timeframe);
      const clampedLimit = Math.min(limit, 1000);

      const geckoNetwork = GECKO_NETWORKS[chain];
      const url = `https://api.geckoterminal.com/api/v2/networks/${geckoNetwork}/pools/${poolAddress}/ohlcv/${period}?aggregate=${aggregate}&limit=${clampedLimit}&currency=usd`;

      console.log(`[DexChartClient] Fetching candlesticks from: ${url}`);

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.error(`[DexChartClient] GeckoTerminal returned ${res.status} for ${tokenAddress}`);
        return [];
      }

      const json: any = await res.json();
      const ohlcvList = json?.data?.attributes?.ohlcv_list;
      if (!Array.isArray(ohlcvList) || ohlcvList.length === 0) {
        console.log(`[DexChartClient] No OHLCV data for ${tokenAddress} on ${chain}`);
        return [];
      }

      // GeckoTerminal returns [timestamp, open, high, low, close, volume] newest first
      // Reverse to oldest-first for lightweight-charts
      return ohlcvList
        .map((c: number[]) => ({
          time: c[0],
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5] ?? 0,
        }))
        .reverse();
    } catch (err) {
      console.error(`DexChartClient getCandlesticks failed for ${tokenAddress} on ${chain}:`, err);
      return [];
    }
  }
}
