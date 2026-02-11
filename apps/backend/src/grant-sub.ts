/**
 * Grant a subscription to a user.
 *
 * Usage:
 *   bun run grant-sub <id_or_telegram_id>
 *
 * Accepts either the database user ID or the Telegram ID.
 *
 * Examples:
 *   bun run grant-sub 1            # by user id
 *   bun run grant-sub 1165131649   # by telegram id
 *
 * If the user already has an active subscription, it will tell you and exit.
 * Assigns the next available slot number automatically.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

type UserRow = { id: number; telegram_id: string; username: string | null; first_name: string | null };

const dbPath = process.env.DATABASE_URL || "./data/pmc.db";
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode = WAL;");

const input = process.argv[2];
if (!input) {
  console.error("Usage: bun run grant-sub <id_or_telegram_id>");
  process.exit(1);
}

// Try matching by user id first, then by telegram_id
let user = sqlite
  .prepare("SELECT id, telegram_id, username, first_name FROM users WHERE id = ?")
  .get(input) as UserRow | null;

if (!user) {
  user = sqlite
    .prepare("SELECT id, telegram_id, username, first_name FROM users WHERE telegram_id = ?")
    .get(input) as UserRow | null;
}

if (!user) {
  console.error(`No user found matching "${input}" (checked both id and telegram_id).`);

  const allUsers = sqlite
    .prepare("SELECT id, telegram_id, username, first_name FROM users ORDER BY id")
    .all() as UserRow[];

  if (allUsers.length > 0) {
    console.log("\nExisting users:");
    for (const u of allUsers) {
      console.log(`  id=${u.id}  tg=${u.telegram_id}  @${u.username || "-"}  ${u.first_name || ""}`);
    }
  } else {
    console.log("No users in the database.");
  }
  process.exit(1);
}

const userId = user.id;

// Check existing subscription
const existing = sqlite
  .prepare("SELECT id, status FROM subscriptions WHERE user_id = ? AND status = 'active'")
  .get(userId) as { id: number; status: string } | null;

if (existing) {
  console.log(`User ${userId} (@${user.username || user.first_name}) already has an active subscription (id=${existing.id}).`);
  process.exit(0);
}

// Assign next slot number
const taken = sqlite
  .prepare("SELECT count(*) as count FROM subscriptions WHERE status IN ('active', 'pending')")
  .get() as { count: number };
const slotNumber = (taken?.count ?? 0) + 1;

const now = Math.floor(Date.now() / 1000);

sqlite
  .prepare(
    `INSERT INTO subscriptions (user_id, dodo_subscription_id, dodo_customer_id, status, slot_number, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?)`
  )
  .run(userId, `manual_grant_${userId}_${now}`, null, slotNumber, now, now);

console.log(`Granted active subscription to user ${userId} (@${user.username || user.first_name}), slot #${slotNumber}.`);
