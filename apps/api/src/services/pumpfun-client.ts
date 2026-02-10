import { Redis } from '@upstash/redis/cloudflare';
import type { Env } from '../types/env';

const PUMPFUN_API = 'https://frontend-api.pump.fun';
const PUMPFUN_ADVANCED = 'https://advanced-api-v2.pump.fun';

export interface TokenInfo {
  mint: string;
  name: string;
  symbol: string;
  priceUsd: number;
  marketCapUsd: number;
  holderCount?: number;
}

export interface CandlestickRaw {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HolderInfo {
  address: string;
  balance: string;
  percentage: number;
}

export class PumpFunClient {
  private jwt?: string;

  constructor(jwt?: string) {
    this.jwt = jwt;
  }

  private headers(): HeadersInit {
    const h: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.jwt) {
      h['Authorization'] = `Bearer ${this.jwt}`;
    }
    return h;
  }

  async getTokenInfo(mint: string): Promise<TokenInfo | null> {
    try {
      const res = await fetch(`${PUMPFUN_API}/coins/${mint}?sync=true`, {
        headers: this.headers(),
      });
      if (!res.ok) return null;

      const data: any = await res.json();
      return {
        mint: data.mint,
        name: data.name,
        symbol: data.symbol,
        priceUsd: data.usd_market_cap
          ? data.usd_market_cap / (data.total_supply ?? 1e9)
          : 0,
        marketCapUsd: data.usd_market_cap ?? 0,
        holderCount: data.holder_count ?? undefined,
      };
    } catch (err) {
      console.error(`PumpFun getTokenInfo failed for ${mint}:`, err);
      return null;
    }
  }

  async getCandlesticks(
    mint: string,
    timeframe: number = 300,
    limit: number = 100,
  ): Promise<CandlestickRaw[]> {
    try {
      const res = await fetch(
        `${PUMPFUN_API}/candlesticks/${mint}?timeframe=${timeframe}&limit=${limit}&offset=0`,
        { headers: this.headers() },
      );
      if (!res.ok) return [];

      const data: any[] = await res.json();
      return data.map((c: any) => ({
        timestamp: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }));
    } catch (err) {
      console.error(`PumpFun getCandlesticks failed for ${mint}:`, err);
      return [];
    }
  }

  async getSolPrice(): Promise<number> {
    try {
      const res = await fetch(`${PUMPFUN_API}/sol-price`);
      if (!res.ok) return 0;
      const data: any = await res.json();
      return data.solPrice ?? 0;
    } catch {
      return 0;
    }
  }

  async getTopHolders(mint: string): Promise<HolderInfo[]> {
    try {
      const res = await fetch(
        `${PUMPFUN_ADVANCED}/coins/top-holders-and-sol-balance/${mint}`,
        { headers: this.headers() },
      );
      if (!res.ok) return [];
      const data: any[] = await res.json();
      return data.map((h: any) => ({
        address: h.address,
        balance: h.balance?.toString() ?? '0',
        percentage: h.percentage ?? 0,
      }));
    } catch {
      return [];
    }
  }
}

const SOL_PRICE_CACHE_KEY = 'sol_price_usd';
const SOL_PRICE_TTL = 60;

export async function getSolPrice(env: Env): Promise<number> {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  const cached = await redis.get<string>(SOL_PRICE_CACHE_KEY);
  if (cached) return parseFloat(cached);

  const client = new PumpFunClient();
  const price = await client.getSolPrice();

  if (price > 0) {
    await redis.set(SOL_PRICE_CACHE_KEY, price.toString(), { ex: SOL_PRICE_TTL });
  }

  return price;
}
