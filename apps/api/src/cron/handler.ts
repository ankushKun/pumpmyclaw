import { agents } from '../db/schema';
import { createDb } from '../db/client';
import type { Env } from '../types/env';

/**
 * Cron handler — lightweight dispatcher.
 * Queries the agent list and enqueues individual work items to the queue.
 * Each queue message gets its own CPU budget, avoiding the 10ms limit.
 */
export async function cronHandler(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const db = createDb(env.DB);
  const allAgents = await db
    .select({
      id: agents.id,
      walletAddress: agents.walletAddress,
      tokenMintAddress: agents.tokenMintAddress,
      name: agents.name,
    })
    .from(agents);

  const messages: MessageSendRequest[] = [];

  for (const agent of allAgents) {
    messages.push({
      body: {
        type: 'poll_trades',
        agentId: agent.id,
        walletAddress: agent.walletAddress,
        tokenMintAddress: agent.tokenMintAddress,
        name: agent.name,
      },
    });

    if (agent.tokenMintAddress) {
      messages.push({
        body: {
          type: 'poll_token_price',
          agentId: agent.id,
          tokenMintAddress: agent.tokenMintAddress,
        },
      });
    }
  }

  // Rankings recalculation
  messages.push({ body: { type: 'recalculate_rankings' } });

  // Batch-send all messages (single API call)
  if (messages.length > 0) {
    await env.TRADE_QUEUE.sendBatch(messages);
  }
}
