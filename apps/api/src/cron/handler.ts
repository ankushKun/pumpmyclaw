import { Redis } from '@upstash/redis/cloudflare';
import { eq } from 'drizzle-orm';
import { agents, agentWallets } from '../db/schema';
import { createDb } from '../db/client';
import type { Env } from '../types/env';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_BATCH_SIZE = 100; // CF Queue sendBatch limit

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

  // Guard against concurrent cron runs via Redis lock (60s TTL)
  const lockKey = 'cron:poll_trades:lock';
  const lockAcquired = await redis.set(lockKey, Date.now().toString(), { nx: true, ex: 60 });
  if (!lockAcquired) {
    console.log('Cron: skipping — previous run still in progress');
    return;
  }

  try {
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
      const val = activityValues[idx];
      // Validate that the stored value is a valid epoch timestamp
      const parsed = val ? parseInt(val, 10) : 0;
      agentActivityMap.set(agentId, isNaN(parsed) || parsed < 1e12 ? 0 : parsed);
    });

    const now = Date.now();

    // Collect all inactive wallet IDs that need poll-time checks
    const inactiveWallets: typeof allWallets = [];
    const activeWallets: typeof allWallets = [];

    for (const wallet of allWallets) {
      const lastPing = agentActivityMap.get(wallet.agentId) ?? 0;
      const isActive = (now - lastPing) < ONE_HOUR_MS;

      if (isActive) {
        activeWallets.push(wallet);
      } else {
        inactiveWallets.push(wallet);
      }
    }

    // Batch-fetch last poll times for inactive wallets (mget instead of N+1)
    const walletsToPoll: typeof allWallets = [...activeWallets];

    if (inactiveWallets.length > 0) {
      const pollKeys = inactiveWallets.map(w => `wallet_last_poll:${w.id}`);
      const pollValues = await redis.mget<(string | null)[]>(...pollKeys);

      for (let i = 0; i < inactiveWallets.length; i++) {
        const wallet = inactiveWallets[i];
        const lastPollStr = pollValues[i];
        const lastPoll = lastPollStr ? parseInt(lastPollStr, 10) : 0;

        // Monad can poll more frequently since nad.fun has no credit limits
        const pollInterval = wallet.chain === 'monad' ? FIVE_MINUTES_MS : TWO_HOURS_MS;

        if (isNaN(lastPoll) || (now - lastPoll) >= pollInterval) {
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
        delaySeconds: Math.min(i * delayPerWallet, 55), // Cap at 55s to avoid overlap
      });

      if (wallet.tokenAddress) {
        messages.push({
          body: {
            type: 'poll_token_price',
            agentId: wallet.agentId,
            chain: wallet.chain,
            tokenAddress: wallet.tokenAddress,
          },
          delaySeconds: Math.min(i * delayPerWallet, 55),
        });
      }
    }

    // Rankings always run (after all polls complete)
    messages.push({
      body: { type: 'recalculate_rankings' },
      delaySeconds: Math.min(walletsToPoll.length * delayPerWallet, 55),
    });

    // Send in chunks of 100 (CF Queue sendBatch limit)
    if (messages.length > 0) {
      for (let i = 0; i < messages.length; i += MAX_BATCH_SIZE) {
        const chunk = messages.slice(i, i + MAX_BATCH_SIZE);
        try {
          await env.TRADE_QUEUE.sendBatch(chunk);
        } catch (err) {
          console.error(`Cron: sendBatch failed for chunk ${i}-${i + chunk.length}:`, err);
        }
      }
    }

    if (walletsToPoll.length < allWallets.length) {
      console.log(`Cron: polling ${walletsToPoll.length}/${allWallets.length} wallets (${allWallets.length - walletsToPoll.length} inactive, skipped)`);
    }
  } finally {
    // Release lock early if we finish before TTL
    await redis.del(lockKey).catch(() => {});
  }
}
