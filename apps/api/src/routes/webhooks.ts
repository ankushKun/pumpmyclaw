import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { agentWallets, agents, trades } from '../db/schema';
import { parseSwapPayload } from '../services/swap-parser';
import { getBaseAssetPriceUsd } from '../services/base-asset-price';
import { resolveTokens } from '../services/token-resolver';
import type { HonoEnv } from '../types/hono';

export const webhookRoutes = new Hono<HonoEnv>();

// POST /webhooks/helius — called by Helius on SWAP events
webhookRoutes.post('/helius', async (c) => {
  const authHeader = c.req.header('Authorization');
  const expected = `Bearer ${c.env.HELIUS_WEBHOOK_SECRET}`;
  if (authHeader !== expected) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await c.req.json();
  const db = c.get('db');
  const transactions: any[] = Array.isArray(payload) ? payload : [payload];

  for (const tx of transactions) {
    try {
      const feePayer = tx.feePayer;
      if (!feePayer) continue;

      // Look up wallet in agent_wallets table (not the deprecated agents.walletAddress)
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
            eq(agentWallets.chain, 'solana'),
            eq(agentWallets.walletAddress, feePayer)
          )
        )
        .limit(1);

      if (walletResults.length === 0) continue;

      const wallet = walletResults[0];

      // Get agent name for broadcast
      const agentResult = await db
        .select({ name: agents.name })
        .from(agents)
        .where(eq(agents.id, wallet.agentId))
        .limit(1);

      const agentName = agentResult[0]?.name ?? 'Unknown';

      // Parse swap with correct 4-arg signature
      const parsed = parseSwapPayload(
        tx,
        'solana',
        wallet.walletAddress,
        wallet.tokenAddress,
      );
      if (!parsed) continue;

      // Get SOL price via unified base asset price service
      const baseAssetPrice = await getBaseAssetPriceUsd('solana', c.env);
      if (baseAssetPrice <= 0) {
        console.error(`SOL price unavailable — skipping webhook trade ${parsed.signature}`);
        continue;
      }

      const baseAssetAmountDecimal = parseFloat(parsed.baseAssetAmount) / 1e9;
      const tradeValueUsd = baseAssetAmountDecimal * baseAssetPrice;

      await db
        .insert(trades)
        .values({
          agentId: wallet.agentId,
          walletId: wallet.id,
          chain: 'solana',
          txSignature: parsed.signature,
          blockTime: parsed.blockTime.toISOString(),
          platform: parsed.platform,
          tradeType: parsed.tradeType,
          // Chain-agnostic fields
          tokenInAddress: parsed.tokenInAddress,
          tokenInAmount: parsed.tokenInAmount,
          tokenOutAddress: parsed.tokenOutAddress,
          tokenOutAmount: parsed.tokenOutAmount,
          baseAssetPriceUsd: baseAssetPrice.toString(),
          tradeValueUsd: tradeValueUsd.toString(),
          isBuyback: parsed.isBuyback,
          rawData: tx,
          // Deprecated Solana-specific (backward compat)
          tokenInMint: parsed.tokenInMint ?? parsed.tokenInAddress,
          tokenOutMint: parsed.tokenOutMint ?? parsed.tokenOutAddress,
          solPriceUsd: baseAssetPrice.toString(),
        })
        .onConflictDoNothing({ target: [trades.txSignature, trades.chain] });

      // Push to queue for async processing
      await c.env.TRADE_QUEUE.send({
        type: 'trade_processed',
        agentId: wallet.agentId,
        chain: 'solana',
        txSignature: parsed.signature,
        isBuyback: parsed.isBuyback,
      });

      // Resolve token symbols for broadcast (correct 3-arg signature)
      const tokenMap = await resolveTokens(db, 'solana', [
        parsed.tokenInAddress,
        parsed.tokenOutAddress,
      ]);

      // Broadcast to WebSocket hub with token symbols
      try {
        const hubId = c.env.WEBSOCKET_HUB.idFromName('global');
        const hub = c.env.WEBSOCKET_HUB.get(hubId);
        await hub.fetch(
          new Request('https://internal/broadcast', {
            method: 'POST',
            body: JSON.stringify({
              type: 'trade',
              agentId: wallet.agentId,
              chain: 'solana',
              data: {
                txSignature: parsed.signature,
                platform: parsed.platform,
                tradeType: parsed.tradeType,
                isBuyback: parsed.isBuyback,
                tradeValueUsd: tradeValueUsd.toString(),
                agentName,
                tokenInSymbol:
                  tokenMap.get(parsed.tokenInAddress)?.symbol ?? undefined,
                tokenOutSymbol:
                  tokenMap.get(parsed.tokenOutAddress)?.symbol ?? undefined,
              },
              timestamp: new Date().toISOString(),
            }),
          }),
        );
      } catch (err) {
        console.error('WebSocket broadcast failed:', err);
      }
    } catch (err) {
      console.error('Error processing webhook tx:', err);
    }
  }

  return c.json({ received: true });
});
