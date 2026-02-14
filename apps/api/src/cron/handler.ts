import { Redis } from '@upstash/redis/cloudflare';
import { eq } from 'drizzle-orm';
import { agents, agentWallets } from '../db/schema';
import { createDb } from '../db/client';
import type { Env } from '../types/env';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Cron handler — lightweight dispatcher with activity-based polling.
 *
 * Active agents (API ping within 1 hour): poll all wallets every minute.
 * Inactive agents (no ping for >1 hour):
 *   - Solana wallets: poll every 2 hours (Helius credit limits)
 *   - Monad wallets: poll every 5 minutes (nad.fun has no credit system)
 *
 * NEW: Polls per-wallet for multi-chain support
 */
export async function cronHandler(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const db = createDb(env.DB);
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Fetch all agent wallets (multi-chain support)
  const allWallets = await db
    .select({
      id: agentWallets.id,
      agentId: agentWallets.agentId,
      chain: agentWallets.chain,
      walletAddress: agentWallets.walletAddress,
      tokenAddress: agentWallets.tokenAddress,
      agentName: agents.name,
    })
    .from(agentWallets)
    .innerJoin(agents, eq(agents.id, agentWallets.agentId));

  if (allWallets.length === 0) return;

  // Batch-fetch activity timestamps from Redis (per-agent, not per-wallet)
  const uniqueAgentIds = [...new Set(allWallets.map(w => w.agentId))];
  const activityKeys = uniqueAgentIds.map((agentId) => `agent_activity:${agentId}`);
  const activityValues = await redis.mget<(string | null)[]>(...activityKeys);

  const agentActivityMap = new Map<string, number>();
  uniqueAgentIds.forEach((agentId, idx) => {
    agentActivityMap.set(agentId, activityValues[idx] ? parseInt(activityValues[idx]!, 10) : 0);
  });

  const now = Date.now();
  const walletsToPoll: typeof allWallets = [];

  for (const wallet of allWallets) {
    const lastPing = agentActivityMap.get(wallet.agentId) ?? 0;
    const isActive = (now - lastPing) < ONE_HOUR_MS;

    if (isActive) {
      // Active agent: poll all wallets every minute
      walletsToPoll.push(wallet);
    } else {
      // Inactive agent: check last poll time per wallet
      const lastPollKey = `wallet_last_poll:${wallet.id}`;
      const lastPollStr = await redis.get<string>(lastPollKey);
      const lastPoll = lastPollStr ? parseInt(lastPollStr, 10) : 0;

      // Monad can poll more frequently since nad.fun has no credit limits
      const pollInterval = wallet.chain === 'monad' ? FIVE_MINUTES_MS : TWO_HOURS_MS;

      if ((now - lastPoll) >= pollInterval) {
        walletsToPoll.push(wallet);
      }
    }
  }

  const messages: MessageSendRequest[] = [];

  // Stagger wallet polls to avoid rate limits
  const delayPerWallet = Math.max(1, Math.floor(55 / Math.max(walletsToPoll.length, 1)));

  for (let i = 0; i < walletsToPoll.length; i++) {
    const wallet = walletsToPoll[i];
    messages.push({
      body: {
        type: 'poll_trades',
        walletId: wallet.id,
        agentId: wallet.agentId,
        chain: wallet.chain,
        walletAddress: wallet.walletAddress,
        tokenAddress: wallet.tokenAddress,
        agentName: wallet.agentName,
      },
      delaySeconds: i * delayPerWallet,
    });

    if (wallet.tokenAddress) {
      messages.push({
        body: {
          type: 'poll_token_price',
          agentId: wallet.agentId,
          chain: wallet.chain,
          tokenAddress: wallet.tokenAddress,
        },
        delaySeconds: i * delayPerWallet,
      });
    }
  }

  // Rankings always run
  messages.push({
    body: { type: 'recalculate_rankings' },
    delaySeconds: walletsToPoll.length * delayPerWallet,
  });

  if (messages.length > 0) {
    await env.TRADE_QUEUE.sendBatch(messages);
  }

  if (walletsToPoll.length < allWallets.length) {
    console.log(`Cron: polling ${walletsToPoll.length}/${allWallets.length} wallets (${allWallets.length - walletsToPoll.length} inactive, skipped)`);
  }
}
