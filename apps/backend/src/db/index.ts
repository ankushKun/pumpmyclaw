import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_URL || "./data/pmc.db";
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent performance
sqlite.exec("PRAGMA journal_mode = WAL;");

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    wallet_json TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    container_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    telegram_bot_token TEXT NOT NULL,
    telegram_bot_username TEXT,
    openrouter_api_key TEXT NOT NULL,
    bankr_api_key TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'openrouter/qwen/qwen3-coder:free',
    created_at INTEGER DEFAULT (unixepoch()),
    started_at INTEGER,
    stopped_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    nowpayments_subscription_id TEXT UNIQUE,
    nowpayments_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    slot_number INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch())
  );
`);

// Migration: Add wallet_json column if it doesn't exist
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN wallet_json TEXT;`);
} catch {
  // Column already exists, ignore
}

// Migration: Add current_period_end column to subscriptions
try {
  sqlite.exec(`ALTER TABLE subscriptions ADD COLUMN current_period_end INTEGER;`);
} catch {
  // Column already exists, ignore
}

// Migration: Add OpenAI Codex OAuth fields to instances
for (const col of [
  "llm_provider TEXT NOT NULL DEFAULT 'openrouter'",
  "openai_access_token TEXT",
  "openai_refresh_token TEXT",
  "openai_account_id TEXT",
  "openai_token_expires INTEGER",
]) {
  try {
    sqlite.exec(`ALTER TABLE instances ADD COLUMN ${col};`);
  } catch {
    // Column already exists, ignore
  }
}

// Migration: Add Anthropic setup-token field to instances
try {
  sqlite.exec(`ALTER TABLE instances ADD COLUMN anthropic_setup_token TEXT;`);
} catch {
  // Column already exists, ignore
}

// Migration: Add photo_url to users (for Telegram profile picture / agent avatar)
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN photo_url TEXT;`);
} catch {
  // Column already exists, ignore
}

// Migration: Add email column to users (for NOWPayments subscription reminders)
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN email TEXT;`);
} catch {
  // Column already exists, ignore
}

// Migration: Rename dodo_subscription_id -> nowpayments_subscription_id
// SQLite doesn't support RENAME COLUMN in older versions, so we use ALTER TABLE ADD + copy.
// For newer SQLite (3.25+), we can use RENAME COLUMN directly.
try {
  sqlite.exec(`ALTER TABLE subscriptions RENAME COLUMN dodo_subscription_id TO nowpayments_subscription_id;`);
} catch {
  // Column already renamed or doesn't exist, ignore
}

// Migration: Rename dodo_customer_id -> nowpayments_payment_id
try {
  sqlite.exec(`ALTER TABLE subscriptions RENAME COLUMN dodo_customer_id TO nowpayments_payment_id;`);
} catch {
  // Column already renamed or doesn't exist, ignore
}

export const db = drizzle(sqlite, { schema });
