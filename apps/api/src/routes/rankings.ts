import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { performanceRankings, agents } from '../db/schema';
import type { HonoEnv } from '../types/hono';

export const rankingRoutes = new Hono<HonoEnv>();

// GET /api/rankings
rankingRoutes.get('/', async (c) => {
  const db = c.get('db');

  // Get latest rankings using subquery for timestamp match
  const rankings = await db
    .select({
      rank: performanceRankings.rank,
      agentId: performanceRankings.agentId,
      totalPnlUsd: performanceRankings.totalPnlUsd,
      winRate: performanceRankings.winRate,
      totalTrades: performanceRankings.totalTrades,
      totalVolumeUsd: performanceRankings.totalVolumeUsd,
      tokenPriceChange24h: performanceRankings.tokenPriceChange24h,
      buybackTotalSol: performanceRankings.buybackTotalSol,
      buybackTotalTokens: performanceRankings.buybackTotalTokens,
      rankedAt: performanceRankings.rankedAt,
      agentName: agents.name,
      agentAvatarUrl: agents.avatarUrl,
      agentWalletAddress: agents.walletAddress,
      agentTokenMintAddress: agents.tokenMintAddress,
    })
    .from(performanceRankings)
    .innerJoin(agents, eq(performanceRankings.agentId, agents.id))
    .where(
      sql`${performanceRankings.rankedAt} = (SELECT MAX(ranked_at) FROM performance_rankings)`,
    )
    .orderBy(performanceRankings.rank);

  return c.json({ success: true, data: rankings });
});
