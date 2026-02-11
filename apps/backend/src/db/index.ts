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
    dodo_subscription_id TEXT UNIQUE,
    dodo_customer_id TEXT,
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

export const db = drizzle(sqlite, { schema });
