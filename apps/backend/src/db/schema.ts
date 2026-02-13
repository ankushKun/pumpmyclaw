import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  telegramId: text("telegram_id").notNull().unique(),
  username: text("username"),
  firstName: text("first_name"),
  /** User's email address (required for NOWPayments subscription reminders) */
  email: text("email"),
  // Telegram profile photo URL (used for agent avatar)
  photoUrl: text("photo_url"),
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
  /** "openrouter" | "openai-codex" | "anthropic" — which LLM provider is active */
  llmProvider: text("llm_provider").notNull().default("openrouter"),
  /** Encrypted OpenAI Codex OAuth access token (JWT) */
  openaiAccessToken: text("openai_access_token"),
  /** Encrypted OpenAI Codex OAuth refresh token */
  openaiRefreshToken: text("openai_refresh_token"),
  /** OpenAI account ID extracted from the access token */
  openaiAccountId: text("openai_account_id"),
  /** Timestamp (ms) when the OpenAI access token expires */
  openaiTokenExpires: integer("openai_token_expires"),
  /** Encrypted Anthropic setup-token (from `claude setup-token`) */
  anthropicSetupToken: text("anthropic_setup_token"),
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
  /** NOWPayments subscription ID (from /v1/subscriptions) */
  nowpaymentsSubscriptionId: text("nowpayments_subscription_id").unique(),
  /** NOWPayments payment/invoice ID (most recent payment) */
  nowpaymentsPaymentId: text("nowpayments_payment_id"),
  /** active | on_hold | cancelled | failed | pending | expired */
  status: text("status").notNull().default("pending"),
  /** Slot number 1-10 for early access */
  slotNumber: integer("slot_number"),
  /** End of the current paid billing period (now + 30 days from payment) */
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
