import { eq, desc } from 'drizzle-orm';
import { trades } from '../db/schema';
import type { Database } from '../db/client';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

export interface PnlResult {
  totalPnlUsd: number;
  winRate: number;
  totalTrades: number;
  totalVolumeUsd: number;
  buybackTotalSol: number;
  buybackTotalTokens: number;
}

export async function calculateAgentPnl(
  db: Database,
  agentId: string,
): Promise<PnlResult> {
  const allTrades = await db
    .select()
    .from(trades)
    .where(eq(trades.agentId, agentId))
    .orderBy(desc(trades.blockTime));

  if (allTrades.length === 0) {
    return {
      totalPnlUsd: 0,
      winRate: 0,
      totalTrades: 0,
      totalVolumeUsd: 0,
      buybackTotalSol: 0,
      buybackTotalTokens: 0,
    };
  }

  let totalVolumeUsd = 0;
  let buybackTotalSol = 0;
  let buybackTotalTokens = 0;

  const positions: Map<string, { bought: number; sold: number }> = new Map();

  for (const trade of allTrades) {
    const value = parseFloat(trade.tradeValueUsd);
    totalVolumeUsd += value;

    if (trade.isBuyback) {
      // Use correct decimals based on chain
      const chain = trade.chain ?? 'solana';
      const decimals = chain === 'monad' ? 1e18 : 1e9;
      buybackTotalSol += parseFloat(trade.tokenInAmount) / decimals;
      // Divide tokenOutAmount by decimals to get human-readable token count
      buybackTotalTokens += parseFloat(trade.tokenOutAmount) / decimals;
      continue;
    }

    const tokenMint =
      trade.tokenInMint === SOL_MINT ? trade.tokenOutMint : trade.tokenInMint;

    if (!positions.has(tokenMint)) {
      positions.set(tokenMint, { bought: 0, sold: 0 });
    }

    const pos = positions.get(tokenMint)!;
    if (trade.tradeType === 'buy') {
      pos.bought += value;
    } else {
      pos.sold += value;
    }
  }

  let totalPnl = 0;
  let wins = 0;
  let closedPositions = 0;

  for (const [, pos] of positions) {
    if (pos.sold > 0 && pos.bought > 0) {
      const pnl = pos.sold - pos.bought;
      totalPnl += pnl;
      closedPositions++;
      if (pnl > 0) wins++;
    }
  }

  const winRate = closedPositions > 0 ? (wins / closedPositions) * 100 : 0;

  return {
    totalPnlUsd: totalPnl,
    winRate,
    totalTrades: allTrades.length,
    totalVolumeUsd,
    buybackTotalSol,
    buybackTotalTokens,
  };
}
