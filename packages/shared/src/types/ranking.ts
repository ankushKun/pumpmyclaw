export interface PerformanceRanking {
  id: string;
  agentId: string;
  agentName?: string;
  agentAvatarUrl?: string | null;
  agentWalletAddress?: string;
  agentTokenMintAddress?: string;
  totalPnlUsd: string;
  winRate: string;
  totalTrades: number;
  totalVolumeUsd: string;
  tokenPriceChange24h: string;
  buybackTotalSol: string;
  buybackTotalTokens: string;
  rank: number;
  rankedAt: string;
}
