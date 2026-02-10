import { eq, and, gte } from 'drizzle-orm';
import { agents, performanceRankings, tokenSnapshots } from '../db/schema';
import { calculateAgentPnl } from '../services/pnl-calculator';
import { createDb } from '../db/client';
import type { Env } from '../types/env';

export async function recalculateRankings(env: Env): Promise<void> {
  const db = createDb(env.DATABASE_URL);
  const allAgents = await db.select().from(agents);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const rankingData: Array<{
    agentId: string;
    pnl: number;
    winRate: number;
    totalTrades: number;
    totalVolumeUsd: number;
    tokenPriceChange24h: number;
    buybackTotalSol: number;
    buybackTotalTokens: number;
  }> = [];

  for (const agent of allAgents) {
    try {
      const pnl = await calculateAgentPnl(db, agent.id);

      const snapshots24h = await db
        .select()
        .from(tokenSnapshots)
        .where(
          and(
            eq(tokenSnapshots.agentId, agent.id),
            gte(tokenSnapshots.snapshotAt, yesterday),
          ),
        )
        .orderBy(tokenSnapshots.snapshotAt);

      let priceChange24h = 0;
      if (snapshots24h.length >= 2) {
        const oldest = parseFloat(snapshots24h[0].priceUsd);
        const newest = parseFloat(
          snapshots24h[snapshots24h.length - 1].priceUsd,
        );
        if (oldest > 0) {
          priceChange24h = ((newest - oldest) / oldest) * 100;
        }
      }

      rankingData.push({
        agentId: agent.id,
        pnl: pnl.totalPnlUsd,
        winRate: pnl.winRate,
        totalTrades: pnl.totalTrades,
        totalVolumeUsd: pnl.totalVolumeUsd,
        tokenPriceChange24h: priceChange24h,
        buybackTotalSol: pnl.buybackTotalSol,
        buybackTotalTokens: pnl.buybackTotalTokens,
      });
    } catch (err) {
      console.error(`Ranking calc error for agent ${agent.id}:`, err);
    }
  }

  rankingData.sort((a, b) => b.pnl - a.pnl);

  // Use a shared timestamp so all rankings in this batch can be queried together
  const rankedAt = new Date();

  for (let i = 0; i < rankingData.length; i++) {
    const d = rankingData[i];
    await db.insert(performanceRankings).values({
      agentId: d.agentId,
      totalPnlUsd: d.pnl.toString(),
      winRate: d.winRate.toString(),
      totalTrades: d.totalTrades,
      totalVolumeUsd: d.totalVolumeUsd.toString(),
      tokenPriceChange24h: d.tokenPriceChange24h.toString(),
      buybackTotalSol: d.buybackTotalSol.toString(),
      buybackTotalTokens: d.buybackTotalTokens.toString(),
      rank: i + 1,
      rankedAt,
    });
  }
}
