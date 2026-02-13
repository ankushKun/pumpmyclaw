/**
 * Backfill script for multi-chain migration
 *
 * This script:
 * 1. Creates agent_wallets entries from existing agents
 * 2. Backfills new columns from old columns in trades, token_metadata, token_snapshots
 * 3. Sets walletId on existing trades
 *
 * Run with: npx tsx apps/api/src/scripts/backfill-multichain.ts
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { agents, agentWallets, trades, tokenMetadata, tokenSnapshots, performanceRankings } from '../db/schema';

interface Env {
  DB: D1Database;
}

async function backfillMultichain(db: ReturnType<typeof drizzle>) {
  console.log('Starting multi-chain backfill...');

  // Step 1: Create agent_wallets from existing agents
  console.log('\n1. Creating agent_wallets from existing agents...');
  const existingAgents = await db.select({
    id: agents.id,
    walletAddress: agents.walletAddress,
    tokenMintAddress: agents.tokenMintAddress,
  }).from(agents).where(isNull(agents.walletAddress).not());

  let walletsCreated = 0;
  for (const agent of existingAgents) {
    if (!agent.walletAddress) continue;

    // Check if wallet already exists
    const existing = await db.select({ id: agentWallets.id })
      .from(agentWallets)
      .where(and(
        eq(agentWallets.agentId, agent.id),
        eq(agentWallets.chain, 'solana'),
        eq(agentWallets.walletAddress, agent.walletAddress)
      ))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  → Wallet already exists for agent ${agent.id}`);
      continue;
    }

    const [newWallet] = await db.insert(agentWallets).values({
      agentId: agent.id,
      chain: 'solana',
      walletAddress: agent.walletAddress,
      tokenAddress: agent.tokenMintAddress ?? null,
    }).returning({ id: agentWallets.id });

    walletsCreated++;
    console.log(`  ✓ Created wallet ${newWallet.id} for agent ${agent.id}`);
  }

  console.log(`Created ${walletsCreated} agent wallet records`);

  // Step 2: Backfill trades table
  console.log('\n2. Backfilling trades table...');

  // First, set walletId for existing trades
  const allWallets = await db.select({
    id: agentWallets.id,
    agentId: agentWallets.agentId,
    chain: agentWallets.chain,
  }).from(agentWallets);

  let tradesUpdated = 0;
  for (const wallet of allWallets) {
    // Update all trades for this agent on this chain to reference the wallet
    const result = await db.update(trades)
      .set({ walletId: wallet.id })
      .where(and(
        eq(trades.agentId, wallet.agentId),
        eq(trades.chain, wallet.chain),
        isNull(trades.walletId)
      ));

    // SQLite doesn't return affected rows count easily, so we'll skip counting
    console.log(`  → Updated trades for agent ${wallet.agentId} on chain ${wallet.chain}`);
  }

  // Backfill new columns from old columns
  console.log('\n  Backfilling tokenInAddress from tokenInMint...');
  await db.run(sql`
    UPDATE trades
    SET token_in_address = token_in_mint
    WHERE token_in_address IS NULL AND token_in_mint IS NOT NULL
  `);

  console.log('  Backfilling tokenOutAddress from tokenOutMint...');
  await db.run(sql`
    UPDATE trades
    SET token_out_address = token_out_mint
    WHERE token_out_address IS NULL AND token_out_mint IS NOT NULL
  `);

  console.log('  Backfilling baseAssetPriceUsd from solPriceUsd...');
  await db.run(sql`
    UPDATE trades
    SET base_asset_price_usd = sol_price_usd
    WHERE base_asset_price_usd IS NULL AND sol_price_usd IS NOT NULL
  `);

  console.log('Trades table backfilled');

  // Step 3: Backfill token_metadata table
  console.log('\n3. Backfilling token_metadata table...');
  await db.run(sql`
    UPDATE token_metadata
    SET address = mint
    WHERE address IS NULL AND mint IS NOT NULL
  `);
  console.log('Token metadata table backfilled');

  // Step 4: Backfill token_snapshots table
  console.log('\n4. Backfilling token_snapshots table...');
  await db.run(sql`
    UPDATE token_snapshots
    SET token_address = mint_address
    WHERE token_address IS NULL AND mint_address IS NOT NULL
  `);
  console.log('Token snapshots table backfilled');

  // Step 5: Backfill performance_rankings table
  console.log('\n5. Backfilling performance_rankings table...');
  await db.run(sql`
    UPDATE performance_rankings
    SET buyback_total_base_asset = buyback_total_sol
    WHERE buyback_total_base_asset IS NULL AND buyback_total_sol IS NOT NULL
  `);
  console.log('Performance rankings table backfilled');

  console.log('\n✅ Multi-chain backfill complete!');
}

// For local execution
if (require.main === module) {
  console.error('This script needs to be run with wrangler or in a Worker context');
  console.error('Use: wrangler d1 execute DB --file=apps/api/drizzle/0001_multichain.sql');
  console.error('Then run backfill via an API endpoint or scheduled job');
  process.exit(1);
}

export { backfillMultichain };
