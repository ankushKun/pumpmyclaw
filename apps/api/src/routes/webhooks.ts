import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { agents, trades } from '../db/schema';
import { parseSwapPayload } from '../services/swap-parser';
import { getSolPriceUsd } from '../services/sol-price';
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

      const agentResults = await db
        .select()
        .from(agents)
        .where(eq(agents.walletAddress, feePayer))
        .limit(1);

      if (agentResults.length === 0) continue;

      const agent = agentResults[0];
      const parsed = parseSwapPayload(
        tx,
        agent.walletAddress,
        agent.tokenMintAddress ?? '',
      );
      if (!parsed) continue;

      const solPrice = await getSolPriceUsd(c.env);
      if (solPrice <= 0) {
        console.error(`SOL price unavailable — skipping webhook trade ${parsed.signature}`);
        continue;
      }
      const solAmountDecimal = parseFloat(parsed.solAmount) / 1e9;
      const tradeValueUsd = solAmountDecimal * solPrice;

      await db
        .insert(trades)
        .values({
          agentId: agent.id,
          txSignature: parsed.signature,
          blockTime: parsed.blockTime.toISOString(),
          platform: parsed.platform,
          tradeType: parsed.tradeType,
          tokenInMint: parsed.tokenInMint,
          tokenInAmount: parsed.tokenInAmount,
          tokenOutMint: parsed.tokenOutMint,
          tokenOutAmount: parsed.tokenOutAmount,
          solPriceUsd: solPrice.toString(),
          tradeValueUsd: tradeValueUsd.toString(),
          isBuyback: parsed.isBuyback,
          rawData: tx,
        })
        .onConflictDoNothing({ target: trades.txSignature });

      // Push to queue for async processing
      await c.env.TRADE_QUEUE.send({
        type: 'trade_processed',
        agentId: agent.id,
        txSignature: parsed.signature,
        isBuyback: parsed.isBuyback,
      });

      // Resolve token symbols for broadcast
      const tokenMap = await resolveTokens(db, [
        parsed.tokenInMint,
        parsed.tokenOutMint,
      ]);

      // Broadcast to WebSocket hub with token symbols
      const hubId = c.env.WEBSOCKET_HUB.idFromName('global');
      const hub = c.env.WEBSOCKET_HUB.get(hubId);
      await hub.fetch(
        new Request('https://internal/broadcast', {
          method: 'POST',
          body: JSON.stringify({
            type: 'trade',
            agentId: agent.id,
            data: {
              txSignature: parsed.signature,
              platform: parsed.platform,
              tradeType: parsed.tradeType,
              isBuyback: parsed.isBuyback,
              tradeValueUsd: tradeValueUsd.toString(),
              agentName: agent.name,
              tokenInSymbol:
                tokenMap.get(parsed.tokenInMint)?.symbol ?? undefined,
              tokenOutSymbol:
                tokenMap.get(parsed.tokenOutMint)?.symbol ?? undefined,
            },
            timestamp: new Date().toISOString(),
          }),
        }),
      );
    } catch (err) {
      console.error('Error processing webhook tx:', err);
    }
  }

  return c.json({ received: true });
});
