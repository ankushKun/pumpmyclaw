import { Redis } from '@upstash/redis/cloudflare';
import { agents, tokenSnapshots } from '../db/schema';
import { PumpFunClient } from '../services/pumpfun-client';
import { createDb } from '../db/client';
import type { Env } from '../types/env';

const TOKEN_PRICE_CACHE_PREFIX = 'token_price:';
const PRICE_TTL = 60;

export async function pollTokenPrices(env: Env): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const pumpfun = new PumpFunClient();
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  const allAgents = await db
    .select({
      id: agents.id,
      tokenMintAddress: agents.tokenMintAddress,
    })
    .from(agents);

  for (const agent of allAgents) {
    try {
      const info = await pumpfun.getTokenInfo(agent.tokenMintAddress);
      if (!info) continue;

      await db.insert(tokenSnapshots).values({
        agentId: agent.id,
        mintAddress: agent.tokenMintAddress,
        priceUsd: info.priceUsd.toString(),
        marketCapUsd: info.marketCapUsd.toString(),
        holderCount: info.holderCount ?? null,
      });

      await redis.set(
        `${TOKEN_PRICE_CACHE_PREFIX}${agent.tokenMintAddress}`,
        JSON.stringify({
          priceUsd: info.priceUsd,
          marketCapUsd: info.marketCapUsd,
          updatedAt: new Date().toISOString(),
        }),
        { ex: PRICE_TTL },
      );

      const hubId = env.WEBSOCKET_HUB.idFromName('global');
      const hub = env.WEBSOCKET_HUB.get(hubId);
      await hub.fetch(
        new Request('https://internal/broadcast', {
          method: 'POST',
          body: JSON.stringify({
            type: 'price_update',
            agentId: agent.id,
            data: {
              mint: agent.tokenMintAddress,
              priceUsd: info.priceUsd,
              marketCapUsd: info.marketCapUsd,
            },
            timestamp: new Date().toISOString(),
          }),
        }),
      );
    } catch (err) {
      console.error(`Token poll error for agent ${agent.id}:`, err);
    }
  }

  const solPrice = await pumpfun.getSolPrice();
  if (solPrice > 0) {
    await redis.set('sol_price_usd', solPrice.toString(), { ex: PRICE_TTL });
  }
}
