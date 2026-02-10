import { pollMissedTrades } from './trade-fallback';
import { pollTokenPrices } from './token-poller';
import { recalculateRankings } from './ranking-calculator';
import type { Env } from '../types/env';

function safe(fn: () => Promise<void>, label: string): Promise<void> {
  return fn().catch((err) => console.error(`Cron [${label}] failed:`, err));
}

export async function cronHandler(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  ctx.waitUntil(safe(() => pollMissedTrades(env), 'trade-fallback'));
  ctx.waitUntil(safe(() => pollTokenPrices(env), 'token-poller'));
  ctx.waitUntil(safe(() => recalculateRankings(env), 'rankings'));
}
