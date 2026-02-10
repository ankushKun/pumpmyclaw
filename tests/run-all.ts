import { readFileSync } from 'fs';
import { resolve } from 'path';
import { neon } from '@neondatabase/serverless';
import { printSummary } from './helpers';
import { runHealthTests } from './health.test';
import { runAgentTests } from './agents.test';
import { runWebhookTests } from './webhooks.test';
import { runTradeTests } from './trades.test';
import { runRankingTests } from './rankings.test';

const API_URL = process.env.API_URL ?? 'http://localhost:8787';

// Test wallet addresses — must match agents.test.ts
const TEST_WALLETS = [
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
];

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
  throw new Error('DATABASE_URL not found — cannot clean test data');
}

async function cleanTestData() {
  process.stdout.write('  Cleaning test data...');
  try {
    const sql = neon(getDatabaseUrl());
    // Delete in dependency order (child tables first)
    for (const wallet of TEST_WALLETS) {
      await sql`DELETE FROM trade_annotations WHERE agent_id IN (SELECT id FROM agents WHERE wallet_address = ${wallet})`;
      await sql`DELETE FROM trades WHERE agent_id IN (SELECT id FROM agents WHERE wallet_address = ${wallet})`;
      await sql`DELETE FROM agent_context WHERE agent_id IN (SELECT id FROM agents WHERE wallet_address = ${wallet})`;
      await sql`DELETE FROM token_snapshots WHERE agent_id IN (SELECT id FROM agents WHERE wallet_address = ${wallet})`;
      await sql`DELETE FROM performance_rankings WHERE agent_id IN (SELECT id FROM agents WHERE wallet_address = ${wallet})`;
      await sql`DELETE FROM agents WHERE wallet_address = ${wallet}`;
    }
    console.log(' \x1b[32mdone\x1b[0m');
  } catch (err) {
    console.log(' \x1b[33mskipped\x1b[0m (could not connect to DB)');
  }
}

async function waitForServer(url: string, maxRetries = 20): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  console.log('\x1b[1m\x1b[36m');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║     PUMP MY CLAW — API TEST SUITE    ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('\x1b[0m');
  console.log(`  Target: ${API_URL}\n`);

  // Wait for server
  process.stdout.write('  Waiting for server...');
  const ready = await waitForServer(API_URL);
  if (!ready) {
    console.error(
      '\n\x1b[31m  Server not reachable at ' + API_URL + '. Is it running?\x1b[0m\n',
    );
    process.exit(1);
  }
  console.log(' \x1b[32mready\x1b[0m');

  // Clean up stale test data from previous runs
  await cleanTestData();

  // Run all test groups in order
  await runHealthTests();
  await runAgentTests();
  await runWebhookTests();
  await runTradeTests();
  await runRankingTests();

  printSummary();
}

main().catch((err) => {
  console.error('\x1b[31mFatal error:\x1b[0m', err);
  process.exit(1);
});
