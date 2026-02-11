import { agents } from '../db/schema';
import { HeliusClient } from '../services/helius-client';
import { ingestTradesForAgent } from '../services/trade-ingester';
import { createDb } from '../db/client';
import type { Env } from '../types/env';

export async function pollMissedTrades(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const helius = new HeliusClient(env.HELIUS_API_KEY);

  const allAgents = await db.select().from(agents);

  for (const agent of allAgents) {
    try {
      const result = await ingestTradesForAgent(db, helius, env, {
        id: agent.id,
        walletAddress: agent.walletAddress,
        tokenMintAddress: agent.tokenMintAddress,
        name: agent.name,
      }, {
        limit: 100,
        broadcast: true,
      });

      if (result.inserted > 0) {
        console.log(
          `Cron: ingested ${result.inserted} new trades for agent ${agent.name} (${agent.id})`,
        );
      }
    } catch (err) {
      console.error(`Cron fallback error for agent ${agent.id}:`, err);
    }
  }
}
