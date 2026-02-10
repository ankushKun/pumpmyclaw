import { eq, and, desc } from 'drizzle-orm';
import { trades } from '../db/schema';
import type { Database } from '../db/client';

export interface BuybackSummary {
  totalBuybacks: number;
  totalSolSpent: string;
  totalTokensBought: string;
  lastBuybackAt: string | null;
}

export async function getBuybackSummary(
  db: Database,
  agentId: string,
): Promise<BuybackSummary> {
  const buybacks = await db
    .select()
    .from(trades)
    .where(and(eq(trades.agentId, agentId), eq(trades.isBuyback, true)))
    .orderBy(desc(trades.blockTime));

  let totalSolSpent = 0;
  let totalTokensBought = 0;

  for (const b of buybacks) {
    totalSolSpent += parseFloat(b.tokenInAmount);
    totalTokensBought += parseFloat(b.tokenOutAmount);
  }

  return {
    totalBuybacks: buybacks.length,
    totalSolSpent: totalSolSpent.toString(),
    totalTokensBought: totalTokensBought.toString(),
    lastBuybackAt: buybacks[0]?.blockTime?.toISOString() ?? null,
  };
}
