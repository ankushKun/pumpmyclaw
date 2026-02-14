import { Redis } from '@upstash/redis/cloudflare';
import { HeliusClient } from '../services/helius-client';
import { PumpFunClient } from '../services/pumpfun-client';
import { ingestTradesForAgent, ingestTradesForWallet } from '../services/trade-ingester';
import { recalculateRankings } from '../cron/ranking-calculator';
import { tokenSnapshots } from '../db/schema';
import { createDb } from '../db/client';
import { createProviderRegistry } from '../services/blockchain/provider-registry';
import type { Env } from '../types/env';
import type { Chain } from '../services/blockchain/types';

// DEPRECATED: Old Solana-only message format
interface LegacyPollTradesMessage {
  type: 'poll_trades';
  agentId: string;
  walletAddress: string;
  tokenMintAddress: string | null;
  name: string;
  chain?: never; // Explicitly mark as not having chain field
}

// NEW: Multi-chain message format
interface PollTradesMessage {
  type: 'poll_trades';
  walletId: string;
  agentId: string;
  chain: Chain;
  walletAddress: string;
  tokenAddress: string | null;
  agentName: string;
}

interface PollTokenPriceMessage {
  type: 'poll_token_price';
  agentId: string;
  chain: Chain;
  tokenAddress: string;
}

interface RecalculateRankingsMessage {
  type: 'recalculate_rankings';
}

interface TradeProcessedMessage {
  type: 'trade_processed';
  agentId: string;
  txSignature: string;
  isBuyback: boolean;
}

type QueueMessage =
  | PollTradesMessage
  | LegacyPollTradesMessage
  | PollTokenPriceMessage
  | RecalculateRankingsMessage
  | TradeProcessedMessage;

export async function tradeQueueConsumer(
  batch: MessageBatch<unknown>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body as QueueMessage;

    try {
      switch (body.type) {
        case 'poll_trades':
          await handlePollTrades(body, env);
          break;

        case 'poll_token_price':
          await handlePollTokenPrice(body, env);
          break;

        case 'recalculate_rankings':
          await recalculateRankings(env);
          break;

        case 'trade_processed':
          // Legacy: just log and ack
          console.log(
            `Trade processed: agent=${body.agentId}, tx=${body.txSignature}`,
          );
          break;

        default:
          console.warn('Unknown queue message type:', (body as any).type);
      }
      message.ack();
    } catch (err) {
      console.error(`Queue error [${body.type}]:`, err);
      message.retry();
    }
  }
}

async function handlePollTrades(msg: PollTradesMessage | LegacyPollTradesMessage, env: Env) {
  const db = createDb(env.DB);

  // Check if this is the new multi-chain format or legacy format
  if ('chain' in msg && msg.chain) {
    // NEW: Multi-chain format
    const registry = createProviderRegistry(env);
    const provider = registry.get(msg.chain);

    const result = await ingestTradesForWallet(db, provider, env, {
      id: msg.walletId,
      agentId: msg.agentId,
      chain: msg.chain,
      walletAddress: msg.walletAddress,
      tokenAddress: msg.tokenAddress,
      agentName: msg.agentName,
    }, {
      limit: 100,
      broadcast: true,
    });

    // Record last poll time per wallet
    try {
      const redis = new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      });
      await redis.set(`wallet_last_poll:${msg.walletId}`, Date.now().toString(), { ex: 604800 }); // 7 days TTL to avoid thundering herd
    } catch {
      // non-fatal
    }

    if (result.inserted > 0) {
      console.log(
        `Poll: ingested ${result.inserted} new ${msg.chain} trades for ${msg.agentName} (${msg.agentId})`,
      );
    }
  } else {
    // DEPRECATED: Legacy Solana-only format
    const helius = new HeliusClient(env.HELIUS_API_KEY, env.HELIUS_FALLBACK_KEYS?.split(','));

    const result = await ingestTradesForAgent(db, helius, env, {
      id: msg.agentId,
      walletAddress: msg.walletAddress,
      tokenMintAddress: msg.tokenMintAddress,
      name: msg.name,
    }, {
      limit: 100,
      broadcast: true,
    });

    // Record last poll time (legacy key format)
    try {
      const redis = new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      });
      await redis.set(`agent_last_poll:${msg.agentId}`, Date.now().toString(), { ex: 86400 });
    } catch {
      // non-fatal
    }

    if (result.inserted > 0) {
      console.log(
        `Poll: ingested ${result.inserted} new trades for ${msg.name} (${msg.agentId})`,
      );
    }
  }
}

async function handlePollTokenPrice(msg: PollTokenPriceMessage, env: Env) {
  const db = createDb(env.DB);
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  // Chain-aware token price fetching
  let info: { priceUsd: number; marketCapUsd: number; holderCount?: number | null } | null = null;

  if (msg.chain === 'solana') {
    const pumpfun = new PumpFunClient();
    info = await pumpfun.getTokenInfo(msg.tokenAddress);
  } else if (msg.chain === 'monad') {
    // For Monad tokens, try DexScreener
    try {
      const res = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${msg.tokenAddress}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data: any = await res.json();
        const pairs = data.pairs;
        if (Array.isArray(pairs) && pairs.length > 0) {
          const pair = pairs[0];
          info = {
            priceUsd: parseFloat(pair.priceUsd ?? '0'),
            marketCapUsd: parseFloat(pair.marketCap ?? pair.fdv ?? '0'),
            holderCount: null,
          };
        }
      }
    } catch (err) {
      console.error(`[poll_token_price] DexScreener failed for Monad token ${msg.tokenAddress}:`, err);
    }
  }

  if (!info || info.priceUsd <= 0) return;

  await db.insert(tokenSnapshots).values({
    agentId: msg.agentId,
    chain: msg.chain,
    tokenAddress: msg.tokenAddress,
    mintAddress: msg.tokenAddress, // Deprecated field, kept for backward compat
    priceUsd: info.priceUsd.toString(),
    marketCapUsd: info.marketCapUsd.toString(),
    holderCount: info.holderCount ?? null,
  });

  await redis.set(
    `token_price:${msg.chain}:${msg.tokenAddress}`,
    JSON.stringify({
      priceUsd: info.priceUsd,
      marketCapUsd: info.marketCapUsd,
      updatedAt: new Date().toISOString(),
    }),
    { ex: 60 },
  );

  try {
    const hubId = env.WEBSOCKET_HUB.idFromName('global');
    const hub = env.WEBSOCKET_HUB.get(hubId);
    await hub.fetch(
      new Request('https://internal/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          type: 'price_update',
          agentId: msg.agentId,
          chain: msg.chain,
          data: {
            mint: msg.tokenAddress,
            tokenAddress: msg.tokenAddress,
            priceUsd: info.priceUsd,
            marketCapUsd: info.marketCapUsd,
          },
          timestamp: new Date().toISOString(),
        }),
      }),
    );
  } catch (err) {
    console.error('[poll_token_price] WebSocket broadcast failed:', err);
  }
}
