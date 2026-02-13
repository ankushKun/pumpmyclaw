import { eq, inArray, and } from 'drizzle-orm';
import { agents, trades, agentWallets } from '../db/schema';
import { HeliusClient } from './helius-client';
import { parseSwapPayload } from './swap-parser';
import { getSolPriceUsd } from './sol-price';
import { getBaseAssetPriceUsd } from './base-asset-price';
import { resolveTokens } from './token-resolver';
import type { Database } from '../db/client';
import type { Env } from '../types/env';
import type { BlockchainProvider, Chain } from './blockchain/types';

// DEPRECATED: Use AgentWalletInfo instead
export interface AgentInfo {
  id: string;
  walletAddress: string;
  tokenMintAddress: string | null;
  name: string;
}

// NEW: Per-wallet info for multi-chain support
export interface AgentWalletInfo {
  id: string; // wallet ID from agent_wallets table
  agentId: string;
  chain: Chain;
  walletAddress: string;
  tokenAddress: string | null;
  agentName: string;
}

export interface IngestResult {
  inserted: number;
  total: number;
  signatures: number;
}

/**
 * NEW: Chain-agnostic trade ingestion per wallet
 *
 * Flow:
 * 1. Fetch recent signatures via BlockchainProvider
 * 2. Filter out already-ingested txs (batch DB check by chain + signature)
 * 3. Batch-fetch enhanced transactions
 * 4. Parse swaps with chain-specific parser
 * 5. Get base asset price (SOL or MON)
 * 6. Insert trades + resolve token metadata
 * 7. Optionally broadcast to WebSocket
 */
export async function ingestTradesForWallet(
  db: Database,
  provider: BlockchainProvider,
  env: Env,
  wallet: AgentWalletInfo,
  options?: {
    limit?: number;
    broadcast?: boolean;
  },
): Promise<IngestResult> {
  const sigLimit = options?.limit ?? 50;
  const shouldBroadcast = options?.broadcast ?? false;

  // 1. Fetch recent signatures
  const signatures = await provider.getSignaturesForAddress(
    wallet.walletAddress,
    { limit: sigLimit },
  );

  if (signatures.length === 0) {
    return { inserted: 0, total: 0, signatures: 0 };
  }

  // 2. Batch-check which signatures are already in DB (filter by chain + signature)
  const existingTxs = await db
    .select({ txSignature: trades.txSignature })
    .from(trades)
    .where(
      and(
        inArray(trades.txSignature, signatures),
        eq(trades.chain, wallet.chain)
      )
    );

  const existingSet = new Set(existingTxs.map((t) => t.txSignature));
  const newSigs = signatures.filter((s) => !existingSet.has(s));

  if (newSigs.length === 0) {
    return { inserted: 0, total: signatures.length, signatures: signatures.length };
  }

  // 3. Batch-fetch enhanced transactions
  const enhancedTxs = await provider.getEnhancedTransactions(newSigs);

  if (enhancedTxs.length === 0) {
    return { inserted: 0, total: signatures.length, signatures: signatures.length };
  }

  // 4. Parse swaps (chain-specific parser)
  const parsedTrades = enhancedTxs
    .map((tx) =>
      parseSwapPayload(tx, wallet.chain, wallet.walletAddress, wallet.tokenAddress)
    )
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (parsedTrades.length === 0) {
    return { inserted: 0, total: signatures.length, signatures: signatures.length };
  }

  // 5. Get base asset price (SOL or MON)
  const baseAssetPrice = await getBaseAssetPriceUsd(wallet.chain, env);
  if (baseAssetPrice <= 0) {
    console.error(`${wallet.chain} price unavailable — skipping trade insertion for ${wallet.agentName}`);
    return { inserted: 0, total: signatures.length, signatures: signatures.length };
  }

  // 6. Insert trades
  let inserted = 0;
  const allTokenAddresses: string[] = [];

  // Decimal conversion: Solana = 1e9 lamports, EVM = 1e18 wei
  const decimals = wallet.chain === 'solana' ? 1e9 : 1e18;

  for (const parsed of parsedTrades) {
    const baseAssetAmountDecimal = parseFloat(parsed.baseAssetAmount) / decimals;
    const tradeValueUsd = baseAssetAmountDecimal * baseAssetPrice;

    try {
      const result = await db
        .insert(trades)
        .values({
          agentId: wallet.agentId,
          walletId: wallet.id,
          chain: wallet.chain,
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
          rawData: enhancedTxs.find((tx: any) => tx.signature === parsed.signature) ?? null,
          // DEPRECATED: Solana-specific (for backward compatibility)
          tokenInMint: parsed.tokenInMint,
          tokenOutMint: parsed.tokenOutMint,
          solPriceUsd: parsed.solAmount ? baseAssetPrice.toString() : undefined,
        })
        .onConflictDoNothing({ target: [trades.txSignature, trades.chain] })
        .returning({ id: trades.id });

      if (result.length > 0) {
        inserted++;
        allTokenAddresses.push(parsed.tokenInAddress, parsed.tokenOutAddress);

        // Broadcast new trade to WebSocket
        if (shouldBroadcast) {
          try {
            const tokenMap = await resolveTokens(db, wallet.chain, [
              parsed.tokenInAddress,
              parsed.tokenOutAddress,
            ]);

            const hubId = env.WEBSOCKET_HUB.idFromName('global');
            const hub = env.WEBSOCKET_HUB.get(hubId);
            await hub.fetch(
              new Request('https://internal/broadcast', {
                method: 'POST',
                body: JSON.stringify({
                  type: 'trade',
                  agentId: wallet.agentId,
                  chain: wallet.chain,
                  data: {
                    txSignature: parsed.signature,
                    platform: parsed.platform,
                    tradeType: parsed.tradeType,
                    isBuyback: parsed.isBuyback,
                    tradeValueUsd: tradeValueUsd.toString(),
                    agentName: wallet.agentName,
                    tokenInSymbol:
                      tokenMap.get(parsed.tokenInAddress)?.symbol ?? undefined,
                    tokenOutSymbol:
                      tokenMap.get(parsed.tokenOutAddress)?.symbol ?? undefined,
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

  // 7. Pre-cache token metadata for all new addresses
  if (allTokenAddresses.length > 0) {
    try {
      await resolveTokens(db, wallet.chain, allTokenAddresses);
    } catch {
      // Non-fatal
    }
  }

  return {
    inserted,
    total: signatures.length,
    signatures: signatures.length,
  };
}

/**
 * DEPRECATED: Solana-only trade ingestion per agent
 * Use ingestTradesForWallet instead
 *
 * Kept for backward compatibility during migration
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

  // 4. Attempt to parse ALL transactions as swaps.
  // Helius may label pump.fun / DEX trades as SWAP, UNKNOWN, TRANSFER, etc.
  // The parser itself returns null for non-swap transactions, so let it decide.
  const parsedTrades = enhancedTxs
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
          rawData: enhancedTxs.find((tx: any) => tx.signature === parsed.signature) ?? null,
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
