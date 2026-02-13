import { Redis } from '@upstash/redis/cloudflare';
import { agents } from '../db/schema';
import { createDb } from '../db/client';
import type { Env } from '../types/env';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * Cron handler — lightweight dispatcher with activity-based polling.
 *
 * Active agents (API ping within 1 hour): poll every minute.
 * Inactive agents (no ping for >1 hour): poll every 2 hours only.
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

  const allAgents = await db
    .select({
      id: agents.id,
      walletAddress: agents.walletAddress,
      tokenMintAddress: agents.tokenMintAddress,
      name: agents.name,
    })
    .from(agents);

  if (allAgents.length === 0) return;

  // Batch-fetch activity and last-poll timestamps from Redis
  const activityKeys = allAgents.map((a) => `agent_activity:${a.id}`);
  const lastPollKeys = allAgents.map((a) => `agent_last_poll:${a.id}`);
  const [activityValues, lastPollValues] = await Promise.all([
    redis.mget<(string | null)[]>(...activityKeys),
    redis.mget<(string | null)[]>(...lastPollKeys),
  ]);

  const now = Date.now();
  const agentsToPoll: typeof allAgents = [];

  for (let i = 0; i < allAgents.length; i++) {
    const lastPing = activityValues[i] ? parseInt(activityValues[i]!, 10) : 0;
    const lastPoll = lastPollValues[i] ? parseInt(lastPollValues[i]!, 10) : 0;
    const isActive = (now - lastPing) < ONE_HOUR_MS;

    if (isActive) {
      // Active: poll every minute
      agentsToPoll.push(allAgents[i]);
    } else {
      // Inactive: only poll every 2 hours
      if ((now - lastPoll) >= TWO_HOURS_MS) {
        agentsToPoll.push(allAgents[i]);
      }
    }
  }

  const messages: MessageSendRequest[] = [];

  // Stagger trade polls to avoid Helius 429 rate limits
  const delayPerAgent = Math.max(1, Math.floor(55 / Math.max(agentsToPoll.length, 1)));

  for (let i = 0; i < agentsToPoll.length; i++) {
    const agent = agentsToPoll[i];
    messages.push({
      body: {
        type: 'poll_trades',
        agentId: agent.id,
        walletAddress: agent.walletAddress,
        tokenMintAddress: agent.tokenMintAddress,
        name: agent.name,
      },
      delaySeconds: i * delayPerAgent,
    });

    if (agent.tokenMintAddress) {
      messages.push({
        body: {
          type: 'poll_token_price',
          agentId: agent.id,
          tokenMintAddress: agent.tokenMintAddress,
        },
        delaySeconds: i * delayPerAgent,
      });
    }
  }

  // Rankings always run
  messages.push({
    body: { type: 'recalculate_rankings' },
    delaySeconds: agentsToPoll.length * delayPerAgent,
  });

  if (messages.length > 0) {
    await env.TRADE_QUEUE.sendBatch(messages);
  }

  if (agentsToPoll.length < allAgents.length) {
    console.log(`Cron: polling ${agentsToPoll.length}/${allAgents.length} agents (${allAgents.length - agentsToPoll.length} inactive, skipped)`);
  }
}
