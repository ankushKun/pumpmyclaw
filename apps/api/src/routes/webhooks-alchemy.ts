/**
 * Alchemy webhook endpoint for Monad/nad.fun trade events
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { agentWallets, trades } from '../db/schema';
import { parseSwapPayload } from '../services/swap-parser';
import { getBaseAssetPriceUsd } from '../services/base-asset-price';
import { resolveTokens } from '../services/token-resolver';
import type { HonoEnv } from '../types/hono';

export const alchemyWebhookRoutes = new Hono<HonoEnv>();

// POST /webhooks/alchemy — called by Alchemy on Monad events
alchemyWebhookRoutes.post('/', async (c) => {
  const authHeader = c.req.header('Authorization');
  const expected = `Bearer ${c.env.ALCHEMY_WEBHOOK_SECRET}`;

  if (authHeader !== expected) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await c.req.json();
  const db = c.get('db');

  // Alchemy webhook format: { event: { activity: [...] } }
  const activities = payload.event?.activity ?? [payload];

  for (const activity of activities) {
    try {
      // Extract sender address (fromAddress or from)
      const fromAddress = (activity.fromAddress ?? activity.from ?? '').toLowerCase();
      if (!fromAddress) continue;

      // Find wallet by address + chain
      const walletResults = await db
        .select({
          id: agentWallets.id,
          agentId: agentWallets.agentId,
          chain: agentWallets.chain,
          walletAddress: agentWallets.walletAddress,
          tokenAddress: agentWallets.tokenAddress,
        })
        .from(agentWallets)
        .where(
          and(
            eq(agentWallets.chain, 'monad'),
            eq(agentWallets.walletAddress, fromAddress)
          )
        )
        .limit(1);

      if (walletResults.length === 0) continue;

      const wallet = walletResults[0];

      // Parse swap from Alchemy activity format
      // Normalize to our transaction format
      const normalizedTx = {
        signature: activity.hash ?? activity.transactionHash,
        timestamp: activity.timestamp ?? Math.floor(Date.now() / 1000),
        logs: activity.logs ?? [],
        rawData: activity,
      };

      const parsed = parseSwapPayload(
        normalizedTx,
        'monad',
        wallet.walletAddress,
        wallet.tokenAddress
      );

      if (!parsed) continue;

      // Get MON price
      const baseAssetPrice = await getBaseAssetPriceUsd('monad', c.env);
      if (baseAssetPrice <= 0) {
        console.error(`MON price unavailable — skipping webhook trade ${parsed.signature}`);
        continue;
      }

      const baseAssetAmountDecimal = parseFloat(parsed.baseAssetAmount) / 1e18; // EVM decimals
      const tradeValueUsd = baseAssetAmountDecimal * baseAssetPrice;

      // Insert trade
      await db
        .insert(trades)
        .values({
          agentId: wallet.agentId,
          walletId: wallet.id,
          chain: 'monad',
          txSignature: parsed.signature,
          blockTime: parsed.blockTime.toISOString(),
          platform: parsed.platform,
          tradeType: parsed.tradeType,
          // NEW: chain-agnostic fields
          tokenInAddress: parsed.tokenInAddress,
          tokenInAmount: parsed.tokenInAmount,
          tokenOutAddress: parsed.tokenOutAddress,
          tokenOutAmount: parsed.tokenOutAmount,
          baseAssetPriceUsd: baseAssetPrice.toString(),
          tradeValueUsd: tradeValueUsd.toString(),
          isBuyback: parsed.isBuyback,
          rawData: normalizedTx,
          // DEPRECATED: Solana-specific (for backward compatibility)
          tokenInMint: parsed.tokenInAddress,
          tokenOutMint: parsed.tokenOutAddress,
          solPriceUsd: undefined,
        })
        .onConflictDoNothing({ target: [trades.txSignature, trades.chain] });

      // Push to queue for async processing
      await c.env.TRADE_QUEUE.send({
        type: 'trade_processed',
        agentId: wallet.agentId,
        chain: 'monad',
        txSignature: parsed.signature,
        isBuyback: parsed.isBuyback,
      });

      // Resolve token symbols for broadcast
      const tokenMap = await resolveTokens(db, 'monad', [
        parsed.tokenInAddress,
        parsed.tokenOutAddress,
      ]);

      // Broadcast via WebSocket
      try {
        const hubId = c.env.WEBSOCKET_HUB.idFromName('global');
        const hub = c.env.WEBSOCKET_HUB.get(hubId);
        await hub.fetch(
          new Request('https://internal/broadcast', {
            method: 'POST',
            body: JSON.stringify({
              type: 'trade',
              agentId: wallet.agentId,
              chain: 'monad',
              data: {
                txSignature: parsed.signature,
                platform: parsed.platform,
                tradeType: parsed.tradeType,
                isBuyback: parsed.isBuyback,
                tradeValueUsd: tradeValueUsd.toString(),
                tokenInSymbol: tokenMap.get(parsed.tokenInAddress)?.symbol ?? undefined,
                tokenOutSymbol: tokenMap.get(parsed.tokenOutAddress)?.symbol ?? undefined,
              },
              timestamp: new Date().toISOString(),
            }),
          })
        );
      } catch (err) {
        console.error('WebSocket broadcast failed:', err);
      }
    } catch (err) {
      console.error('Alchemy webhook processing error:', err);
      // Continue to next activity
    }
  }

  return c.json({ received: true });
});
