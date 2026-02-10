const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens';
const GECKOTERMINAL_API = 'https://api.geckoterminal.com/api/v2/networks/solana/pools';

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
   * Fetch DexScreener pairs data for a token mint. Reused by getPoolAddress and getTokenStats.
   */
  private async fetchPairs(mint: string): Promise<any[] | null> {
    try {
      const res = await fetch(`${DEXSCREENER_API}/${mint}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;

      const data: any = await res.json();
      const pairs = data.pairs;
      if (!Array.isArray(pairs) || pairs.length === 0) return null;
      return pairs;
    } catch (err) {
      console.error(`DexScreener fetchPairs failed for ${mint}:`, err);
      return null;
    }
  }

  /**
   * Resolve a token mint to a Solana pool address via DexScreener.
   */
  async getPoolAddress(mint: string): Promise<string | null> {
    const pairs = await this.fetchPairs(mint);
    if (!pairs) return null;
    const solanaPair = pairs.find((p: any) => p.chainId === 'solana');
    return solanaPair?.pairAddress ?? pairs[0].pairAddress ?? null;
  }

  /**
   * Get live token stats (price, market cap, volume, liquidity, price changes) from DexScreener.
   */
  async getTokenStats(mint: string): Promise<TokenStats | null> {
    const pairs = await this.fetchPairs(mint);
    if (!pairs) return null;

    const p = pairs.find((pair: any) => pair.chainId === 'solana') ?? pairs[0];
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
    mint: string,
    timeframe: number = 300,
    limit: number = 100,
  ): Promise<CandlestickRaw[]> {
    try {
      const poolAddress = await this.getPoolAddress(mint);
      if (!poolAddress) return [];

      const { period, aggregate } = this.mapTimeframe(timeframe);
      const clampedLimit = Math.min(limit, 1000);

      const url = `${GECKOTERMINAL_API}/${poolAddress}/ohlcv/${period}?aggregate=${aggregate}&limit=${clampedLimit}&currency=usd`;

      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];

      const json: any = await res.json();
      const ohlcvList = json?.data?.attributes?.ohlcv_list;
      if (!Array.isArray(ohlcvList) || ohlcvList.length === 0) return [];

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
      console.error(`DexChartClient getCandlesticks failed for ${mint}:`, err);
      return [];
    }
  }
}
