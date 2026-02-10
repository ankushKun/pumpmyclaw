/**
 * Backfill script — fetches real trading history from Helius for a Solana wallet
 * and ingests it into the Pump My Claw database.
 *
 * Usage:
 *   npx tsx scripts/backfill-agent.ts <walletAddress> [options]
 *
 * Options:
 *   --name "Bot Name"        Agent display name (default: "Agent <wallet prefix>")
 *   --token-mint <mint>      Agent's token mint (default: placeholder)
 *   --hours <number>         Hours of history to fetch (default: 48)
 *
 * Requires:
 *   - API server running at localhost:8787
 *   - HELIUS_API_KEY + DATABASE_URL in env or apps/api/.dev.vars
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { neon } from '@neondatabase/serverless';

// ─── Config ──────────────────────────────────────────────
const API = process.env.API_URL ?? 'http://localhost:8787';
const HELIUS_API_BASE = 'https://api-mainnet.helius-rpc.com';
const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PLACEHOLDER_TOKEN_MINT = 'PLACEHOLDER_NO_TOKEN_MINT_ADDRESS_00000000';

// ─── Read .dev.vars ──────────────────────────────────────
function readDevVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const content = readFileSync(
      resolve(__dirname, '../apps/api/.dev.vars'),
      'utf-8',
    );
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) vars[match[1]] = match[2].trim();
    }
  } catch {}
  return vars;
}

const devVars = readDevVars();
const DATABASE_URL = process.env.DATABASE_URL ?? devVars.DATABASE_URL;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? devVars.HELIUS_API_KEY;

if (!DATABASE_URL) throw new Error('DATABASE_URL not found');
if (!HELIUS_API_KEY) throw new Error('HELIUS_API_KEY not found');

// ─── CLI arg parsing ─────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const walletAddress = args.find((a) => !a.startsWith('--'));
  if (!walletAddress) {
    console.error('Usage: npx tsx scripts/backfill-agent.ts <walletAddress> [--name "Name"] [--token-mint <mint>] [--hours 48]');
    process.exit(1);
  }

  let name = `Agent ${walletAddress.slice(0, 6)}`;
  let tokenMint = PLACEHOLDER_TOKEN_MINT;
  let hours = 48;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name' && args[i + 1]) name = args[++i];
    if (args[i] === '--token-mint' && args[i + 1]) tokenMint = args[++i];
    if (args[i] === '--hours' && args[i + 1]) hours = parseInt(args[++i], 10);
  }

  return { walletAddress, name, tokenMint, hours };
}

// ─── Helius helpers ──────────────────────────────────────
async function getSignaturesForAddress(
  address: string,
  options: { limit?: number; before?: string } = {},
): Promise<any[]> {
  const res = await fetch(`${HELIUS_RPC_BASE}/?api-key=${HELIUS_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [address, { limit: options.limit ?? 1000, ...options }],
    }),
  });
  const json: any = await res.json();
  return json.result ?? [];
}

async function getEnhancedTransactions(signatures: string[]): Promise<any[]> {
  if (signatures.length === 0) return [];
  const res = await fetch(
    `${HELIUS_API_BASE}/v0/transactions/?api-key=${HELIUS_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions: signatures }),
    },
  );
  if (!res.ok) {
    throw new Error(`Helius batch transactions failed: ${res.status} ${await res.text()}`);
  }
  const json: any = await res.json();
  return Array.isArray(json) ? json : [];
}

async function getSolPrice(): Promise<number> {
  // Try pump.fun first
  try {
    const res = await fetch('https://frontend-api.pump.fun/sol-price');
    if (res.ok) {
      const data: any = await res.json();
      if (data.solPrice > 0) return data.solPrice;
    }
  } catch {}
  // Fallback to CoinGecko
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    if (res.ok) {
      const data: any = await res.json();
      if (data.solana?.usd > 0) return data.solana.usd;
    }
  } catch {}
  return 0;
}

// ─── Swap parser ─────────────────────────────────────────
// Handles BOTH formats:
// 1. Webhook format: events.swap with nativeInput/tokenOutputs
// 2. API format: accountData with tokenBalanceChanges + nativeBalanceChange

interface ParsedSwap {
  signature: string;
  blockTime: Date;
  platform: string;
  tradeType: 'buy' | 'sell';
  tokenInMint: string;
  tokenInAmount: string;
  tokenOutMint: string;
  tokenOutAmount: string;
  solAmount: string;
  isBuyback: boolean;
}

function parseSwapPayload(
  tx: any,
  agentWallet: string,
  agentTokenMint: string,
): ParsedSwap | null {
  // Skip failed transactions
  if (tx.transactionError) return null;

  const signature = tx.signature;
  const blockTime = new Date((tx.timestamp ?? 0) * 1000);
  const platform = tx.source ?? 'UNKNOWN';

  // Try webhook format first (events.swap)
  const swap = tx.events?.swap;
  if (swap && (swap.nativeInput || swap.nativeOutput || swap.tokenInputs?.length || swap.tokenOutputs?.length)) {
    return parseWebhookFormat(swap, tx, signature, blockTime, platform, agentWallet, agentTokenMint);
  }

  // Fallback: parse from accountData + tokenTransfers (API format)
  return parseApiFormat(tx, signature, blockTime, platform, agentWallet, agentTokenMint);
}

function parseWebhookFormat(
  swap: any, tx: any, signature: string, blockTime: Date,
  platform: string, agentWallet: string, agentTokenMint: string,
): ParsedSwap | null {
  const nativeIn = swap.nativeInput;
  const nativeOut = swap.nativeOutput;
  const tokenIns: any[] = swap.tokenInputs ?? [];
  const tokenOuts: any[] = swap.tokenOutputs ?? [];

  let tokenInMint: string;
  let tokenInAmount: string;
  let tokenOutMint: string;
  let tokenOutAmount: string;
  let solAmount = '0';
  let tradeType: 'buy' | 'sell';

  if (nativeIn && tokenOuts.length > 0) {
    tokenInMint = SOL_MINT;
    tokenInAmount = nativeIn.amount;
    tokenOutMint = tokenOuts[0].mint;
    tokenOutAmount = tokenOuts[0].rawTokenAmount.tokenAmount;
    solAmount = nativeIn.amount;
    tradeType = 'buy';
  } else if (tokenIns.length > 0 && nativeOut) {
    tokenInMint = tokenIns[0].mint;
    tokenInAmount = tokenIns[0].rawTokenAmount.tokenAmount;
    tokenOutMint = SOL_MINT;
    tokenOutAmount = nativeOut.amount;
    solAmount = nativeOut.amount;
    tradeType = 'sell';
  } else if (tokenIns.length > 0 && tokenOuts.length > 0) {
    tokenInMint = tokenIns[0].mint;
    tokenInAmount = tokenIns[0].rawTokenAmount.tokenAmount;
    tokenOutMint = tokenOuts[0].mint;
    tokenOutAmount = tokenOuts[0].rawTokenAmount.tokenAmount;
    solAmount = '0';
    tradeType = 'buy';
  } else {
    return null;
  }

  return {
    signature, blockTime, platform, tradeType,
    tokenInMint, tokenInAmount, tokenOutMint, tokenOutAmount,
    solAmount, isBuyback: tokenOutMint === agentTokenMint,
  };
}

function parseApiFormat(
  tx: any, signature: string, blockTime: Date,
  platform: string, agentWallet: string, agentTokenMint: string,
): ParsedSwap | null {
  const accountData: any[] = tx.accountData ?? [];
  const tokenTransfers: any[] = tx.tokenTransfers ?? [];

  // Find our wallet's native SOL balance change
  const ourAccount = accountData.find((a: any) => a.account === agentWallet);
  const solDelta = ourAccount?.nativeBalanceChange ?? 0; // in lamports

  // Find token balance changes for our wallet (could be via token accounts)
  const ourTokenChanges: Array<{ mint: string; amount: string; delta: number }> = [];

  for (const acct of accountData) {
    for (const change of acct.tokenBalanceChanges ?? []) {
      if (change.userAccount === agentWallet) {
        const rawAmount = change.rawTokenAmount?.tokenAmount ?? '0';
        ourTokenChanges.push({
          mint: change.mint,
          amount: rawAmount.replace('-', ''),
          delta: parseInt(rawAmount, 10),
        });
      }
    }
  }

  // Also check tokenTransfers for our wallet
  if (ourTokenChanges.length === 0) {
    for (const transfer of tokenTransfers) {
      if (transfer.fromUserAccount === agentWallet) {
        const rawAmount = Math.floor(transfer.tokenAmount * Math.pow(10, 6)).toString();
        ourTokenChanges.push({
          mint: transfer.mint,
          amount: rawAmount,
          delta: -Math.abs(parseInt(rawAmount, 10)),
        });
      } else if (transfer.toUserAccount === agentWallet) {
        const rawAmount = Math.floor(transfer.tokenAmount * Math.pow(10, 6)).toString();
        ourTokenChanges.push({
          mint: transfer.mint,
          amount: rawAmount,
          delta: Math.abs(parseInt(rawAmount, 10)),
        });
      }
    }
  }

  if (ourTokenChanges.length === 0 && solDelta === 0) return null;

  // Determine trade direction from balance changes
  let tradeType: 'buy' | 'sell';
  let tokenInMint: string;
  let tokenInAmount: string;
  let tokenOutMint: string;
  let tokenOutAmount: string;
  let solAmount = '0';

  // Find tokens we sent (negative delta) and received (positive delta)
  const tokensSent = ourTokenChanges.filter((c) => c.delta < 0);
  const tokensReceived = ourTokenChanges.filter((c) => c.delta > 0);

  if (solDelta > 0 && tokensSent.length > 0) {
    // Received SOL, sent tokens → SELL
    tradeType = 'sell';
    tokenInMint = tokensSent[0].mint;
    tokenInAmount = tokensSent[0].amount;
    tokenOutMint = SOL_MINT;
    tokenOutAmount = Math.abs(solDelta).toString();
    solAmount = Math.abs(solDelta).toString();
  } else if (solDelta < 0 && tokensReceived.length > 0) {
    // Sent SOL, received tokens → BUY
    tradeType = 'buy';
    tokenInMint = SOL_MINT;
    tokenInAmount = Math.abs(solDelta).toString();
    tokenOutMint = tokensReceived[0].mint;
    tokenOutAmount = tokensReceived[0].amount;
    solAmount = Math.abs(solDelta).toString();
  } else if (tokensSent.length > 0 && tokensReceived.length > 0) {
    // Token-to-token swap
    tradeType = 'buy';
    tokenInMint = tokensSent[0].mint;
    tokenInAmount = tokensSent[0].amount;
    tokenOutMint = tokensReceived[0].mint;
    tokenOutAmount = tokensReceived[0].amount;
    solAmount = '0';
  } else if (tokensSent.length > 0 && solDelta > 0) {
    // Sent token, gained SOL (Pump.fun sell via balance changes)
    tradeType = 'sell';
    tokenInMint = tokensSent[0].mint;
    tokenInAmount = tokensSent[0].amount;
    tokenOutMint = SOL_MINT;
    tokenOutAmount = Math.abs(solDelta).toString();
    solAmount = Math.abs(solDelta).toString();
  } else {
    return null;
  }

  return {
    signature, blockTime, platform, tradeType,
    tokenInMint, tokenInAmount, tokenOutMint, tokenOutAmount,
    solAmount, isBuyback: tokenOutMint === agentTokenMint,
  };
}

// ─── API helpers ─────────────────────────────────────────
async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function get(path: string) {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, data: await res.json().catch(() => null) };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  const { walletAddress, name, tokenMint, hours } = parseArgs();
  const cutoffTime = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);

  console.log('\n  Pump My Claw — Real Wallet Backfill\n');
  console.log(`  Wallet:     ${walletAddress}`);
  console.log(`  Name:       ${name}`);
  console.log(`  Token Mint: ${tokenMint === PLACEHOLDER_TOKEN_MINT ? '(none — using placeholder)' : tokenMint}`);
  console.log(`  Timeframe:  Last ${hours} hours`);
  console.log('');

  // ── Step 1: Register agent ──────────────────────────────
  console.log('  Step 1: Registering agent...');
  let agentId: string;

  const { status, data } = await post('/api/agents/register', {
    name,
    bio: `Real trading bot — wallet ${walletAddress.slice(0, 8)}...`,
    walletAddress,
    tokenMintAddress: tokenMint,
  });

  if (status === 201 && data?.data) {
    agentId = data.data.agentId;
    console.log(`    + Registered: ${agentId}`);
    console.log(`    + API Key: ${data.data.apiKey}`);
  } else if (status === 409) {
    console.log('    ~ Already registered, looking up...');
    const agents = await get('/api/agents');
    const existing = agents.data?.data?.find(
      (a: any) => a.walletAddress === walletAddress,
    );
    if (!existing) {
      console.error('    ! Could not find existing agent');
      process.exit(1);
    }
    agentId = existing.id;
    console.log(`    + Found: ${agentId}`);
  } else {
    console.error('    ! Registration failed:', data);
    process.exit(1);
  }

  // ── Step 2: Fetch signatures ────────────────────────────
  console.log('\n  Step 2: Fetching transaction signatures...');
  let allSignatures: any[] = [];
  let before: string | undefined;
  let page = 0;

  while (true) {
    const sigs = await getSignaturesForAddress(walletAddress, {
      limit: 1000,
      ...(before ? { before } : {}),
    });
    page++;

    if (sigs.length === 0) break;

    // Filter: no errors, within time window
    const filtered = sigs.filter(
      (s: any) => !s.err && s.blockTime && s.blockTime >= cutoffTime,
    );
    allSignatures.push(...filtered);

    console.log(`    Page ${page}: ${sigs.length} sigs, ${filtered.length} in window`);

    // Stop if we've gone past the time window
    const oldestTime = sigs[sigs.length - 1]?.blockTime;
    if (!oldestTime || oldestTime < cutoffTime) break;

    before = sigs[sigs.length - 1].signature;
    await sleep(150); // Rate limit: 10 RPS
  }

  console.log(`    Total: ${allSignatures.length} signatures in last ${hours}h`);

  if (allSignatures.length === 0) {
    console.log('\n  No transactions found in the time window. Done.');
    return;
  }

  // ── Step 3: Batch fetch enhanced transactions ───────────
  console.log('\n  Step 3: Fetching enhanced transactions...');
  const BATCH_SIZE = 100;
  let allEnhancedTxs: any[] = [];

  for (let i = 0; i < allSignatures.length; i += BATCH_SIZE) {
    const batch = allSignatures.slice(i, i + BATCH_SIZE);
    const signatures = batch.map((s: any) => s.signature);

    try {
      const enhanced = await getEnhancedTransactions(signatures);
      allEnhancedTxs.push(...enhanced);
      console.log(`    Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${enhanced.length} enhanced txs`);
    } catch (err: any) {
      console.error(`    ! Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${err.message}`);
    }

    if (i + BATCH_SIZE < allSignatures.length) {
      await sleep(150);
    }
  }

  console.log(`    Total enhanced: ${allEnhancedTxs.length}`);

  // ── Step 4: Filter for swaps and parse ──────────────────
  console.log('\n  Step 4: Parsing swap transactions...');
  const swapTxs = allEnhancedTxs.filter((tx) => tx.type === 'SWAP');
  console.log(`    SWAP transactions: ${swapTxs.length} of ${allEnhancedTxs.length} total`);

  // Log other transaction types for context
  const typeCounts = new Map<string, number>();
  for (const tx of allEnhancedTxs) {
    const t = tx.type ?? 'UNKNOWN';
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  for (const [type, count] of typeCounts) {
    console.log(`      ${type}: ${count}`);
  }

  const parsedTrades: ParsedSwap[] = [];
  let parseFailures = 0;

  for (const tx of swapTxs) {
    const parsed = parseSwapPayload(tx, walletAddress, tokenMint);
    if (parsed) {
      parsedTrades.push(parsed);
    } else {
      parseFailures++;
    }
  }

  console.log(`    Parsed: ${parsedTrades.length} trades (${parseFailures} skipped)`);

  if (parsedTrades.length === 0) {
    console.log('\n  No swap trades found. Done.');
    return;
  }

  // ── Step 5: Get SOL price and calculate USD values ──────
  console.log('\n  Step 5: Calculating USD values...');
  const solPrice = await getSolPrice();
  if (solPrice === 0) {
    console.error('    ! Failed to fetch SOL price. Using $200 as fallback.');
  }
  const effectiveSolPrice = solPrice > 0 ? solPrice : 200;
  console.log(`    SOL price: $${effectiveSolPrice.toFixed(2)}`);

  // ── Step 6: Insert trades into DB ───────────────────────
  console.log('\n  Step 6: Inserting trades...');
  const sql = neon(DATABASE_URL);
  let insertedCount = 0;
  let skippedCount = 0;

  for (const trade of parsedTrades) {
    try {
      const solAmountDecimal = parseFloat(trade.solAmount) / 1e9;
      const tradeValueUsd = solAmountDecimal * effectiveSolPrice;

      await sql`
        INSERT INTO trades (
          agent_id, tx_signature, block_time, platform,
          trade_type, token_in_mint, token_in_amount,
          token_out_mint, token_out_amount,
          sol_price_usd, trade_value_usd, is_buyback, raw_data
        ) VALUES (
          ${agentId}, ${trade.signature}, ${trade.blockTime.toISOString()}, ${trade.platform},
          ${trade.tradeType}, ${trade.tokenInMint}, ${trade.tokenInAmount},
          ${trade.tokenOutMint}, ${trade.tokenOutAmount},
          ${effectiveSolPrice.toString()}, ${tradeValueUsd.toString()}, ${trade.isBuyback},
          ${JSON.stringify({ source: 'backfill', signature: trade.signature })}
        )
        ON CONFLICT (tx_signature) DO NOTHING
      `;
      insertedCount++;
    } catch (err: any) {
      if (err.message?.includes('duplicate') || err.message?.includes('unique')) {
        skippedCount++;
      } else {
        console.error(`    ! Failed: ${trade.signature.slice(0, 20)}... — ${err.message}`);
      }
    }
  }

  console.log(`    Inserted: ${insertedCount}, Skipped: ${skippedCount}`);

  // ── Step 7: Calculate and insert rankings ───────────────
  console.log('\n  Step 7: Recalculating rankings...');
  try {
    // Fetch all trades for this agent to calculate PnL
    const agentTrades = await sql`
      SELECT trade_type, trade_value_usd, is_buyback, token_in_mint, token_out_mint, token_in_amount
      FROM trades WHERE agent_id = ${agentId}
    `;

    let totalVolumeUsd = 0;
    let buybackTotalSol = 0;
    let buybackTotalTokens = 0;
    const positions = new Map<string, { bought: number; sold: number }>();

    for (const t of agentTrades) {
      const value = parseFloat(t.trade_value_usd);
      totalVolumeUsd += value;

      if (t.is_buyback) {
        buybackTotalSol += parseFloat(t.token_in_amount) / 1e9;
        buybackTotalTokens += parseFloat(t.token_in_amount);
        continue;
      }

      const tokenMintKey =
        t.token_in_mint === SOL_MINT ? t.token_out_mint : t.token_in_mint;

      if (!positions.has(tokenMintKey)) {
        positions.set(tokenMintKey, { bought: 0, sold: 0 });
      }

      const pos = positions.get(tokenMintKey)!;
      if (t.trade_type === 'buy') {
        pos.bought += value;
      } else {
        pos.sold += value;
      }
    }

    let totalPnl = 0;
    let wins = 0;
    let closedPositions = 0;

    for (const [, pos] of positions) {
      if (pos.sold > 0 && pos.bought > 0) {
        const pnl = pos.sold - pos.bought;
        totalPnl += pnl;
        closedPositions++;
        if (pnl > 0) wins++;
      }
    }

    const winRate = closedPositions > 0 ? (wins / closedPositions) * 100 : 0;

    // Delete old rankings for this agent and insert new
    await sql`DELETE FROM performance_rankings WHERE agent_id = ${agentId}`;

    // Get all agents' rankings to determine rank position
    const allAgentsRes = await get('/api/agents');
    const allAgentIds: string[] = (allAgentsRes.data?.data ?? []).map((a: any) => a.id);

    // Simple rank: just insert this agent, let ranking endpoint handle sorting
    await sql`
      INSERT INTO performance_rankings (
        agent_id, total_pnl_usd, win_rate, total_trades, total_volume_usd,
        token_price_change_24h, buyback_total_sol, buyback_total_tokens, rank, ranked_at
      ) VALUES (
        ${agentId}, ${totalPnl.toString()}, ${winRate.toString()},
        ${agentTrades.length}, ${totalVolumeUsd.toString()},
        ${'0'}, ${buybackTotalSol.toString()}, ${buybackTotalTokens.toString()},
        ${1}, NOW()
      )
    `;

    // Re-rank all agents by PnL
    const latestRankings = await sql`
      SELECT DISTINCT ON (agent_id) agent_id, total_pnl_usd
      FROM performance_rankings
      ORDER BY agent_id, ranked_at DESC
    `;
    const sorted = latestRankings.sort(
      (a, b) => parseFloat(b.total_pnl_usd) - parseFloat(a.total_pnl_usd),
    );
    for (let i = 0; i < sorted.length; i++) {
      await sql`
        UPDATE performance_rankings SET rank = ${i + 1}
        WHERE agent_id = ${sorted[i].agent_id}
        AND ranked_at = (SELECT MAX(ranked_at) FROM performance_rankings WHERE agent_id = ${sorted[i].agent_id})
      `;
    }

    console.log(`    P&L: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
    console.log(`    Win Rate: ${winRate.toFixed(1)}% (${closedPositions} closed positions)`);
    console.log(`    Total Volume: $${totalVolumeUsd.toFixed(2)}`);
  } catch (err: any) {
    console.error(`    ! Ranking failed: ${err.message}`);
  }

  // ── Summary ─────────────────────────────────────────────
  const buys = parsedTrades.filter((t) => t.tradeType === 'buy' && !t.isBuyback);
  const sells = parsedTrades.filter((t) => t.tradeType === 'sell');
  const buybacks = parsedTrades.filter((t) => t.isBuyback);

  const totalBuyValue = buys.reduce((sum, t) => {
    return sum + (parseFloat(t.solAmount) / 1e9) * effectiveSolPrice;
  }, 0);
  const totalSellValue = sells.reduce((sum, t) => {
    return sum + (parseFloat(t.solAmount) / 1e9) * effectiveSolPrice;
  }, 0);

  console.log('\n  ═══════════════════════════════════════');
  console.log('  BACKFILL SUMMARY');
  console.log('  ═══════════════════════════════════════');
  console.log(`  Wallet:      ${walletAddress}`);
  console.log(`  Agent ID:    ${agentId}`);
  console.log(`  Time window: Last ${hours} hours`);
  console.log(`  SOL price:   $${effectiveSolPrice.toFixed(2)}`);
  console.log('');
  console.log(`  Signatures found:  ${allSignatures.length}`);
  console.log(`  Enhanced txs:      ${allEnhancedTxs.length}`);
  console.log(`  Swap txs:          ${swapTxs.length}`);
  console.log(`  Parsed trades:     ${parsedTrades.length}`);
  console.log(`  Inserted:          ${insertedCount}`);
  console.log('');
  console.log(`  Buys:     ${buys.length} ($${totalBuyValue.toFixed(2)})`);
  console.log(`  Sells:    ${sells.length} ($${totalSellValue.toFixed(2)})`);
  console.log(`  Buybacks: ${buybacks.length}`);
  console.log('');
  console.log(`  Open http://localhost:5173 to see the dashboard.`);
  console.log('');
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
