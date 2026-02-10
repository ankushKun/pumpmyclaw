import { eq, inArray } from 'drizzle-orm';
import { agents, trades } from '../db/schema';
import { HeliusClient } from './helius-client';
import { parseSwapPayload } from './swap-parser';
import { getSolPriceUsd } from './sol-price';
import { resolveTokens } from './token-resolver';
import type { Database } from '../db/client';
import type { Env } from '../types/env';

export interface AgentInfo {
  id: string;
  walletAddress: string;
  tokenMintAddress: string | null;
  name: string;
}

export interface IngestResult {
  inserted: number;
  total: number;
  signatures: number;
}

/**
 * Ingest trades for a single agent from on-chain data.
 * Used by: cron trade-fallback, registration backfill, /sync endpoint.
 *
 * Flow:
 * 1. Fetch recent signatures from Helius
 * 2. Filter out already-ingested txs (batch DB check)
 * 3. Batch-fetch enhanced transactions
 * 4. Parse swaps with unified dual-format parser
 * 5. Insert trades + resolve token metadata
 * 6. Optionally broadcast to WebSocket
 */
export async function ingestTradesForAgent(
  db: Database,
  helius: HeliusClient,
  env: Env,
  agent: AgentInfo,
  options?: {
    limit?: number;
    broadcast?: boolean;
  },
): Promise<IngestResult> {
  const sigLimit = options?.limit ?? 50;
  const shouldBroadcast = options?.broadcast ?? false;

  // 1. Fetch recent signatures
  const signatures = await helius.getSignaturesForAddress(
    agent.walletAddress,
    { limit: sigLimit },
  );

  const validSigs = signatures.filter((s: any) => !s.err);
  if (validSigs.length === 0) {
    return { inserted: 0, total: 0, signatures: 0 };
  }

  // 2. Batch-check which signatures are already in DB
  const sigStrings = validSigs.map((s: any) => s.signature);
  const existingTxs = await db
    .select({ txSignature: trades.txSignature })
    .from(trades)
    .where(inArray(trades.txSignature, sigStrings));

  const existingSet = new Set(existingTxs.map((t) => t.txSignature));
  const newSigs = sigStrings.filter((s) => !existingSet.has(s));

  if (newSigs.length === 0) {
    return { inserted: 0, total: validSigs.length, signatures: validSigs.length };
  }

  // 3. Batch-fetch enhanced transactions (chunks of 100)
  const enhancedTxs: any[] = [];
  for (let i = 0; i < newSigs.length; i += 100) {
    const batch = newSigs.slice(i, i + 100);
    const results = await helius.getEnhancedTransactions(batch);
    enhancedTxs.push(...results);
  }

  // 4. Filter for SWAPs and parse
  const swapTxs = enhancedTxs.filter((tx) => tx.type === 'SWAP');
  const parsedTrades = swapTxs
    .map((tx) =>
      parseSwapPayload(tx, agent.walletAddress, agent.tokenMintAddress ?? ''),
    )
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (parsedTrades.length === 0) {
    return { inserted: 0, total: validSigs.length, signatures: validSigs.length };
  }

  // 5. Get SOL price (Jupiter → CoinGecko → Pump.fun, cached in Redis)
  const solPrice = await getSolPriceUsd(env);
  if (solPrice <= 0) {
    console.error(`SOL price unavailable — skipping trade insertion for agent ${agent.name}`);
    return { inserted: 0, total: validSigs.length, signatures: validSigs.length };
  }

  // 6. Insert trades
  let inserted = 0;
  const allMints: string[] = [];

  for (const parsed of parsedTrades) {
    const solAmountDecimal = parseFloat(parsed.solAmount) / 1e9;
    const tradeValueUsd = solAmountDecimal * solPrice;

    try {
      const result = await db
        .insert(trades)
        .values({
          agentId: agent.id,
          txSignature: parsed.signature,
          blockTime: parsed.blockTime,
          platform: parsed.platform,
          tradeType: parsed.tradeType,
          tokenInMint: parsed.tokenInMint,
          tokenInAmount: parsed.tokenInAmount,
          tokenOutMint: parsed.tokenOutMint,
          tokenOutAmount: parsed.tokenOutAmount,
          solPriceUsd: solPrice.toString(),
          tradeValueUsd: tradeValueUsd.toString(),
          isBuyback: parsed.isBuyback,
          rawData: swapTxs.find((tx) => tx.signature === parsed.signature) ?? null,
        })
        .onConflictDoNothing({ target: trades.txSignature })
        .returning({ id: trades.id });

      if (result.length > 0) {
        inserted++;
        allMints.push(parsed.tokenInMint, parsed.tokenOutMint);

        // Broadcast new trade to WebSocket
        if (shouldBroadcast) {
          try {
            const tokenMap = await resolveTokens(db, [
              parsed.tokenInMint,
              parsed.tokenOutMint,
            ]);

            const hubId = env.WEBSOCKET_HUB.idFromName('global');
            const hub = env.WEBSOCKET_HUB.get(hubId);
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
          } catch {
            // Non-fatal: broadcast failure shouldn't stop ingestion
          }
        }
      }
    } catch {
      // Skip duplicate or failed inserts
    }
  }

  // 7. Pre-cache token metadata for all new mints
  if (allMints.length > 0) {
    try {
      await resolveTokens(db, allMints);
    } catch {
      // Non-fatal
    }
  }

  return {
    inserted,
    total: validSigs.length,
    signatures: validSigs.length,
  };
}
