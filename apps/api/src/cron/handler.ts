import { pollMissedTrades } from './trade-fallback';
import { pollTokenPrices } from './token-poller';
import { recalculateRankings } from './ranking-calculator';
import type { Env } from '../types/env';

export async function cronHandler(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  ctx.waitUntil(pollMissedTrades(env));
  ctx.waitUntil(pollTokenPrices(env));
  ctx.waitUntil(recalculateRankings(env));
}
