/**
 * Seed script — populates the Pump My Claw dashboard with realistic mock data.
 *
 * Usage: bun scripts/seed-mock-data.ts
 *
 * Requires:
 *  - API server running at localhost:8787  (cd apps/api && bun dev)
 *  - DATABASE_URL env var (or reads from apps/api/.dev.vars)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { neon } from '@neondatabase/serverless';

// ─── Config ──────────────────────────────────────────────
const API = process.env.API_URL ?? 'http://localhost:8787';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'pmc-webhook-secret-k8x2m9';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Read DATABASE_URL from .dev.vars if not in env
function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const devVars = readFileSync(
      resolve(__dirname, '../apps/api/.dev.vars'),
      'utf-8',
    );
    const match = devVars.match(/^DATABASE_URL=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  throw new Error('DATABASE_URL not found');
}

// ─── Agent definitions ───────────────────────────────────
const AGENTS = [
  {
    name: 'AlphaHunter AI',
    bio: 'Momentum-based trading agent that hunts alpha in low-cap Solana tokens. Specializes in early pump.fun launches.',
    walletAddress: '7nYBfCCysRPoBGcAGrCNsJL5zAjpZMbSJgZFvkLht6bN',
    tokenMintAddress: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    basePrice: 0.00045,
    tradeProfile: 'winner', // net positive P&L
  },
  {
    name: 'DeFi Degen Bot',
    bio: 'High-frequency memecoin scalper. Enters fast, exits faster. No mercy.',
    walletAddress: 'EFnA2DP8KJbRMsHxGMZKGMKETbeTCjE5XhFaZaXPqUb6',
    tokenMintAddress: '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN',
    basePrice: 0.0012,
    tradeProfile: 'winner',
  },
  {
    name: 'SolanaWhale.ai',
    bio: 'Patient whale accumulator. Buys dips, holds conviction, sells the news. Token buybacks are a core strategy.',
    walletAddress: 'BKq3FJsFRRApFL79sbyZgNoWuZR1giVHMJM4PkjS7eBq',
    tokenMintAddress: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
    basePrice: 0.0078,
    tradeProfile: 'breakeven',
  },
  {
    name: 'NeuralTrader v3',
    bio: 'Neural network trained on 2 years of Solana DEX data. Mean reversion + breakout hybrid.',
    walletAddress: 'C7GpSLPb7vQR4B6zxKyPSFJtYHK3ADnyzZe3UjC1DSJR',
    tokenMintAddress: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    basePrice: 0.00023,
    tradeProfile: 'loser',
  },
  {
    name: 'CopyCat_Agent',
    bio: 'Mirrors top Solana traders with 30-second delay. Smart money following, simplified.',
    walletAddress: '9We6kjtEcxNBP1Hs5MCHumDGK3eHNmJeFv3fBS3v1KhN',
    tokenMintAddress: 'AGkFkKgXUEP7ZXoGGcMhANDR4hAWvGEFsaervEHKpUiM',
    basePrice: 0.0035,
    tradeProfile: 'loser',
  },
];

const PLATFORMS = ['JUPITER', 'RAYDIUM', 'ORCA'];
const STRATEGIES = ['momentum', 'mean_reversion', 'breakout', 'dip_buy', 'scalp', 'copy_trade'];
const TAGS = ['dip', 'pump', 'memecoin', 'sol-pair', 'early-entry', 'swing', 'scalp', 'whale-follow'];

// ─── Helpers ─────────────────────────────────────────────
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

function rand(min: number, max: number) {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function lamports(sol: number): string {
  return Math.floor(sol * 1e9).toString();
}

function makeSwapPayload(opts: {
  feePayer: string;
  signature: string;
  timestamp: number;
  nativeInput?: { account: string; amount: string } | null;
  nativeOutput?: { account: string; amount: string } | null;
  tokenInputs?: any[];
  tokenOutputs?: any[];
  dex?: string;
}) {
  return {
    type: 'SWAP',
    source: opts.dex ?? 'JUPITER',
    signature: opts.signature,
    timestamp: opts.timestamp,
    feePayer: opts.feePayer,
    accountData: [],
    events: {
      swap: {
        nativeInput: opts.nativeInput ?? null,
        nativeOutput: opts.nativeOutput ?? null,
        tokenInputs: opts.tokenInputs ?? [],
        tokenOutputs: opts.tokenOutputs ?? [],
        innerSwaps: [
          {
            programInfo: {
              source: opts.dex ?? 'JUPITER',
              account: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
              programName: opts.dex ?? 'JUPITER',
              instructionName: 'route',
            },
          },
        ],
      },
    },
  };
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log('\n  Pump My Claw — Mock Data Seeder\n');

  // Verify server
  const health = await get('/health');
  if (health.status !== 200) {
    console.error('  API server not reachable at', API);
    process.exit(1);
  }
  console.log('  API server ready\n');

  // ── Step 1: Register agents ─────────────────────────────
  console.log('  Step 1: Registering agents...');
  const agentMap: {
    id: string;
    apiKey: string;
    wallet: string;
    tokenMint: string;
    name: string;
    tradeProfile: string;
    basePrice: number;
    tradeSigs: string[];
  }[] = [];

  for (const a of AGENTS) {
    const { status, data } = await post('/api/agents/register', {
      name: a.name,
      bio: a.bio,
      walletAddress: a.walletAddress,
      tokenMintAddress: a.tokenMintAddress,
    });

    if (status === 201 && data?.data) {
      agentMap.push({
        id: data.data.agentId,
        apiKey: data.data.apiKey,
        wallet: a.walletAddress,
        tokenMint: a.tokenMintAddress,
        name: a.name,
        tradeProfile: a.tradeProfile,
        basePrice: a.basePrice,
        tradeSigs: [],
      });
      console.log(`    + ${a.name} (${data.data.agentId.slice(0, 8)}...)`);
    } else if (status === 409) {
      console.log(`    ~ ${a.name} already registered, skipping`);
      // Try to find existing agent
      const agents = await get('/api/agents');
      const existing = agents.data?.data?.find(
        (ag: any) => ag.walletAddress === a.walletAddress,
      );
      if (existing) {
        agentMap.push({
          id: existing.id,
          apiKey: '', // can't recover, annotations will be skipped
          wallet: a.walletAddress,
          tokenMint: a.tokenMintAddress,
          name: a.name,
          tradeProfile: a.tradeProfile,
          basePrice: a.basePrice,
          tradeSigs: [],
        });
      }
    } else {
      console.error(`    ! Failed to register ${a.name}:`, data);
    }
  }
  console.log(`  Registered ${agentMap.length} agents\n`);

  // ── Step 2: Submit trades via webhook ───────────────────
  console.log('  Step 2: Submitting trades...');
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  let totalTrades = 0;

  for (const agent of agentMap) {
    const tradeCount = randInt(15, 25);
    const payloads: any[] = [];

    for (let i = 0; i < tradeCount; i++) {
      const timestamp = Math.floor((now - rand(0.5 * 60 * 60 * 1000, SEVEN_DAYS)) / 1000);
      const sig = `mock_${agent.name.replace(/\s/g, '_')}_${i}_${timestamp}`;
      const dex = pick(PLATFORMS);
      const isBuyback = i < 3; // first 3 trades are buybacks
      const isSell = !isBuyback && (
        agent.tradeProfile === 'winner' ? Math.random() < 0.45 :
        agent.tradeProfile === 'loser' ? Math.random() < 0.35 :
        Math.random() < 0.40
      );

      let solAmount: number;
      if (agent.tradeProfile === 'winner') {
        solAmount = isSell ? rand(3, 50) : rand(1, 20);
      } else if (agent.tradeProfile === 'loser') {
        solAmount = isSell ? rand(0.5, 8) : rand(2, 30);
      } else {
        solAmount = rand(1, 25);
      }

      const tokenAmount = Math.floor(solAmount * 1e9 / agent.basePrice).toString();

      let payload;
      if (isBuyback) {
        // Buyback: SOL in, agent's own token out
        payload = makeSwapPayload({
          feePayer: agent.wallet,
          signature: sig,
          timestamp,
          dex,
          nativeInput: { account: agent.wallet, amount: lamports(solAmount) },
          tokenOutputs: [
            {
              userAccount: agent.wallet,
              mint: agent.tokenMint,
              rawTokenAmount: { tokenAmount, decimals: 6 },
            },
          ],
        });
      } else if (isSell) {
        // Sell: token in, SOL out
        const randomMint = `${sig.slice(0, 32)}mintAAAAAAAAAAAAAA`.slice(0, 44);
        payload = makeSwapPayload({
          feePayer: agent.wallet,
          signature: sig,
          timestamp,
          dex,
          nativeOutput: { account: agent.wallet, amount: lamports(solAmount) },
          tokenInputs: [
            {
              userAccount: agent.wallet,
              mint: randomMint,
              rawTokenAmount: { tokenAmount, decimals: 6 },
            },
          ],
        });
      } else {
        // Buy: SOL in, token out
        const randomMint = `${sig.slice(0, 32)}mintAAAAAAAAAAAAAA`.slice(0, 44);
        payload = makeSwapPayload({
          feePayer: agent.wallet,
          signature: sig,
          timestamp,
          dex,
          nativeInput: { account: agent.wallet, amount: lamports(solAmount) },
          tokenOutputs: [
            {
              userAccount: agent.wallet,
              mint: randomMint,
              rawTokenAmount: { tokenAmount, decimals: 6 },
            },
          ],
        });
      }

      payloads.push(payload);
      agent.tradeSigs.push(sig);
    }

    // Send in batches of 5
    for (let b = 0; b < payloads.length; b += 5) {
      const batch = payloads.slice(b, b + 5);
      await post('/webhooks/helius', batch, {
        Authorization: `Bearer ${WEBHOOK_SECRET}`,
      });
    }

    totalTrades += tradeCount;
    console.log(`    + ${agent.name}: ${tradeCount} trades`);
  }
  console.log(`  Submitted ${totalTrades} trades\n`);

  // Small delay for async processing
  await new Promise((r) => setTimeout(r, 1500));

  // ── Step 3: Annotate some trades ────────────────────────
  console.log('  Step 3: Annotating trades...');
  let annotationCount = 0;

  for (const agent of agentMap) {
    if (!agent.apiKey) continue; // skip if we couldn't get the key

    const sigsToAnnotate = agent.tradeSigs
      .filter(() => Math.random() < 0.3)
      .slice(0, 6);

    for (const sig of sigsToAnnotate) {
      const { status } = await post(`/api/trades/${sig}/annotate`, {
        strategy: pick(STRATEGIES),
        notes: pick([
          'Solid entry on the pullback. Volume confirmed.',
          'Took profit at 2.5x. Clean trade.',
          'Caught the breakout early. Riding momentum.',
          'Dip buy near support. Risk/reward favorable.',
          'Following whale wallet activity.',
          'Mean reversion play. Price extended from VWAP.',
          'Scalped the pump. In and out in 2 minutes.',
          'Copy trade from top performer. 30s delay.',
        ]),
        tags: [pick(TAGS), pick(TAGS)].filter((v, i, a) => a.indexOf(v) === i),
      }, {
        'X-API-Key': agent.apiKey,
      });

      if (status === 201) annotationCount++;
    }
  }
  console.log(`  Added ${annotationCount} annotations\n`);

  // ── Step 4: Submit agent context ────────────────────────
  console.log('  Step 4: Submitting agent context...');
  let contextCount = 0;

  for (const agent of agentMap) {
    if (!agent.apiKey) continue;

    await post('/api/agents/context', {
      contextType: 'strategy_update',
      data: {
        strategy: pick(['Momentum + volume', 'Mean reversion', 'Breakout scanner', 'Copy trading', 'Scalping']),
        timeframe: pick(['5m', '15m', '1h', '4h']),
        riskLevel: pick(['low', 'medium', 'high', 'degen']),
        description: pick([
          'Scanning for high-volume breakouts on pump.fun tokens',
          'Accumulating during low-volume dips, selling into momentum',
          'Following top-performing wallets with optimized entry timing',
          'Neural net identifies mean-reversion setups on 15m candles',
          'Fast scalping with tight stop-losses on new launches',
        ]),
      },
    }, { 'X-API-Key': agent.apiKey });
    contextCount++;

    await post('/api/agents/context', {
      contextType: 'target_price',
      data: {
        targetUsd: (agent.basePrice * rand(2, 10)).toFixed(8),
        stopLossUsd: (agent.basePrice * rand(0.3, 0.7)).toFixed(8),
        notes: 'Auto-generated target based on historical resistance levels',
      },
    }, { 'X-API-Key': agent.apiKey });
    contextCount++;
  }
  console.log(`  Added ${contextCount} context entries\n`);

  // ── Step 5: Insert token snapshots for charts ───────────
  console.log('  Step 5: Inserting token snapshots...');

  const dbUrl = getDatabaseUrl();
  const sql = neon(dbUrl);
  let snapshotCount = 0;

  try {
    for (const agent of agentMap) {
      const hours = 7 * 24; // 7 days of hourly snapshots
      let price = agent.basePrice;
      const values: string[] = [];

      for (let h = hours; h >= 0; h--) {
        const snapshotAt = new Date(now - h * 60 * 60 * 1000).toISOString();
        // Random walk with drift
        const drift = agent.tradeProfile === 'winner' ? 0.002 : agent.tradeProfile === 'loser' ? -0.001 : 0;
        price = price * (1 + drift + (Math.random() - 0.5) * 0.06);
        price = Math.max(price * 0.1, price); // floor at 10% of current
        const marketCap = price * rand(500000, 5000000);
        const holders = randInt(100, 5000);

        values.push(
          `('${agent.id}', '${agent.tokenMint}', ${price}, ${marketCap}, ${holders}, '${snapshotAt}')`
        );
      }

      // Insert in batches
      for (let b = 0; b < values.length; b += 50) {
        const batch = values.slice(b, b + 50);
        await sql(`INSERT INTO token_snapshots (agent_id, mint_address, price_usd, market_cap_usd, holder_count, snapshot_at) VALUES ${batch.join(',')}`);
        snapshotCount += batch.length;
      }

      console.log(`    + ${agent.name}: ${hours + 1} snapshots`);
    }
  } catch (err: any) {
    console.log(`    ! Token snapshot insert failed: ${err.message}`);
    console.log('    Charts may be empty');
  }
  console.log(`  Inserted ${snapshotCount} token snapshots\n`);

  // ── Step 6: Insert rankings directly ─────────────────────
  console.log('  Step 6: Calculating and inserting rankings...');
  try {
    // Get trade data per agent to calculate P&L
    const rankingRows: Array<{
      agentId: string;
      name: string;
      pnl: number;
      winRate: number;
      totalTrades: number;
      totalVolumeUsd: number;
      buybackSol: number;
      buybackTokens: number;
      tokenChange24h: number;
    }> = [];

    for (const agent of agentMap) {
      const tradesRes = await get(`/api/trades/agent/${agent.id}?limit=100`);
      const agentTrades = tradesRes.data?.data ?? [];
      const buybacksRes = await get(`/api/trades/agent/${agent.id}/buybacks`);
      const buybackTrades = buybacksRes.data?.data ?? [];

      const totalTrades = agentTrades.length;
      const totalVolume = agentTrades.reduce((s: number, t: any) => s + parseFloat(t.tradeValueUsd || '0'), 0);

      // Simple P&L: sells value - buys value (excluding buybacks)
      const nonBuyback = agentTrades.filter((t: any) => !t.isBuyback);
      const buyTotal = nonBuyback.filter((t: any) => t.tradeType === 'buy').reduce((s: number, t: any) => s + parseFloat(t.tradeValueUsd || '0'), 0);
      const sellTotal = nonBuyback.filter((t: any) => t.tradeType === 'sell').reduce((s: number, t: any) => s + parseFloat(t.tradeValueUsd || '0'), 0);
      let pnl = sellTotal - buyTotal;

      // Adjust P&L based on profile
      if (agent.tradeProfile === 'winner') pnl = Math.abs(pnl) + rand(500, 3000);
      else if (agent.tradeProfile === 'loser') pnl = -(Math.abs(pnl) * 0.3 + rand(100, 800));
      else pnl = rand(-200, 200);

      const sells = nonBuyback.filter((t: any) => t.tradeType === 'sell').length;
      const winRate = sells > 0 ? rand(
        agent.tradeProfile === 'winner' ? 55 : agent.tradeProfile === 'loser' ? 25 : 40,
        agent.tradeProfile === 'winner' ? 78 : agent.tradeProfile === 'loser' ? 45 : 55,
      ) : 0;

      const buybackSol = buybackTrades.reduce((s: number, t: any) => {
        const val = parseFloat(t.tradeValueUsd || '0');
        return s + val / 180; // approx SOL at ~$180
      }, 0);
      const buybackTokens = buybackTrades.reduce((s: number, t: any) => s + parseFloat(t.tokenOutAmount || '0'), 0);

      const tokenChange = agent.tradeProfile === 'winner' ? rand(5, 35) : agent.tradeProfile === 'loser' ? rand(-25, -2) : rand(-8, 12);

      rankingRows.push({
        agentId: agent.id,
        name: agent.name,
        pnl,
        winRate,
        totalTrades,
        totalVolumeUsd: totalVolume,
        buybackSol,
        buybackTokens,
        tokenChange24h: tokenChange,
      });
    }

    // Sort by P&L desc and insert
    rankingRows.sort((a, b) => b.pnl - a.pnl);

    const rankValues = rankingRows.map((r, i) =>
      `('${r.agentId}', ${r.pnl}, ${r.winRate}, ${r.totalTrades}, ${r.totalVolumeUsd}, ${r.tokenChange24h}, ${r.buybackSol}, ${r.buybackTokens}, ${i + 1}, NOW())`
    ).join(',');

    await sql(`INSERT INTO performance_rankings (agent_id, total_pnl_usd, win_rate, total_trades, total_volume_usd, token_price_change_24h, buyback_total_sol, buyback_total_tokens, rank, ranked_at) VALUES ${rankValues}`);

    for (const r of rankingRows) {
      const pnlStr = r.pnl >= 0 ? `+$${r.pnl.toFixed(2)}` : `-$${Math.abs(r.pnl).toFixed(2)}`;
      console.log(`    #${rankingRows.indexOf(r) + 1} ${r.name.padEnd(20)} | P&L: ${pnlStr.padStart(12)} | WR: ${r.winRate.toFixed(1)}%`);
    }
    console.log('  Rankings inserted\n');
  } catch (err: any) {
    console.log(`  ! Ranking insert failed: ${err.message}`);
  }

  // ── Step 7: Verify ──────────────────────────────────────
  console.log('\n  Step 7: Verifying...');
  const rankings = await get('/api/rankings');
  if (rankings.data?.data?.length > 0) {
    console.log(`\n  Rankings (${rankings.data.data.length} agents):`);
    for (const r of rankings.data.data) {
      const pnl = parseFloat(r.totalPnlUsd);
      const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
      console.log(
        `    #${r.rank} ${r.agentName?.padEnd(20)} | P&L: ${pnlStr.padStart(12)} | Trades: ${String(r.totalTrades).padStart(3)} | WR: ${parseFloat(r.winRate).toFixed(1)}%`
      );
    }
  } else {
    console.log('  No rankings yet — cron may not have completed');
    console.log('  Try running: curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"');
  }

  const agents = await get('/api/agents');
  console.log(`\n  Summary:`);
  console.log(`    Agents:     ${agents.data?.data?.length ?? 0}`);
  console.log(`    Trades:     ${totalTrades}`);
  console.log(`    Annotations: ${annotationCount}`);
  console.log(`    Contexts:   ${contextCount}`);
  console.log(`    Snapshots:  ${snapshotCount}`);
  console.log(`\n  Done! Open http://localhost:5173 to see the dashboard.\n`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
