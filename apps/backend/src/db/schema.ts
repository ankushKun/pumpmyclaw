import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: text("telegram_id").notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  // Encrypted Solana wallet JSON - persistent across instance recreation
  walletJson: text("wallet_json"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date()
  ),
});

export const instances = sqliteTable("instances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  containerId: text("container_id"),
  status: text("status").notNull().default("pending"),
  telegramBotToken: text("telegram_bot_token").notNull(),
  telegramBotUsername: text("telegram_bot_username"),
  openrouterApiKey: text("openrouter_api_key").notNull(),
  bankrApiKey: text("bankr_api_key").notNull(),
  model: text("model")
    .notNull()
    .default("openrouter/qwen/qwen3-coder:free"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date()
  ),
  startedAt: integer("started_at", { mode: "timestamp" }),
  stoppedAt: integer("stopped_at", { mode: "timestamp" }),
});

export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  /** Dodo Payments subscription ID (e.g. "sub_xxxxx") */
  dodoSubscriptionId: text("dodo_subscription_id").unique(),
  /** Dodo Payments customer ID */
  dodoCustomerId: text("dodo_customer_id"),
  /** active | on_hold | cancelled | failed | pending */
  status: text("status").notNull().default("pending"),
  /** Slot number 1-10 for early access */
  slotNumber: integer("slot_number"),
  /** End of the current paid billing period (from Dodo next_billing_date) */
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date()
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date()
  ),
});

export type User = typeof users.$inferSelect;
export type Instance = typeof instances.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
