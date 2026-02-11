import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql, relations } from 'drizzle-orm';

// ─── agents ─────────────────────────────────────────────
export const agents = sqliteTable('agents', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  name: text('name').notNull(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  walletAddress: text('wallet_address').notNull().unique(),
  tokenMintAddress: text('token_mint_address'),
  apiKeyHash: text('api_key_hash').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('agents_wallet_idx').on(table.walletAddress),
]);

// ─── trades ─────────────────────────────────────────────
export const trades = sqliteTable('trades', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  txSignature: text('tx_signature').notNull().unique(),
  blockTime: text('block_time').notNull(),
  platform: text('platform').notNull(),
  tradeType: text('trade_type').notNull(),
  tokenInMint: text('token_in_mint').notNull(),
  tokenInAmount: text('token_in_amount').notNull(),
  tokenOutMint: text('token_out_mint').notNull(),
  tokenOutAmount: text('token_out_amount').notNull(),
  solPriceUsd: text('sol_price_usd').notNull(),
  tradeValueUsd: text('trade_value_usd').notNull(),
  isBuyback: integer('is_buyback', { mode: 'boolean' }).notNull().default(false),
  rawData: text('raw_data', { mode: 'json' }),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('trades_tx_sig_idx').on(table.txSignature),
  index('trades_agent_id_idx').on(table.agentId),
  index('trades_block_time_idx').on(table.blockTime),
  index('trades_agent_buyback_idx').on(table.agentId, table.isBuyback),
]);

// ─── trade_annotations ──────────────────────────────────
export const tradeAnnotations = sqliteTable('trade_annotations', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  tradeId: text('trade_id').notNull().references(() => trades.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  strategy: text('strategy'),
  notes: text('notes'),
  tags: text('tags', { mode: 'json' }).$type<string[] | null>(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// ─── agent_context ──────────────────────────────────────
export const agentContext = sqliteTable('agent_context', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  contextType: text('context_type').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('agent_context_agent_id_idx').on(table.agentId),
]);

// ─── token_snapshots ────────────────────────────────────
export const tokenSnapshots = sqliteTable('token_snapshots', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  mintAddress: text('mint_address').notNull(),
  priceUsd: text('price_usd').notNull(),
  marketCapUsd: text('market_cap_usd').notNull(),
  holderCount: integer('holder_count'),
  snapshotAt: text('snapshot_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('token_snapshots_agent_id_idx').on(table.agentId),
  index('token_snapshots_snapshot_at_idx').on(table.snapshotAt),
]);

// ─── token_metadata (cache) ─────────────────────────────
export const tokenMetadata = sqliteTable('token_metadata', {
  mint: text('mint').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  decimals: integer('decimals').notNull().default(6),
  logoUrl: text('logo_url'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ─── performance_rankings ───────────────────────────────
export const performanceRankings = sqliteTable('performance_rankings', {
  id: text('id').$defaultFn(() => crypto.randomUUID()).primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  totalPnlUsd: text('total_pnl_usd').notNull(),
  winRate: text('win_rate').notNull(),
  totalTrades: integer('total_trades').notNull(),
  totalVolumeUsd: text('total_volume_usd').notNull(),
  tokenPriceChange24h: text('token_price_change_24h').notNull(),
  buybackTotalSol: text('buyback_total_sol').notNull(),
  buybackTotalTokens: text('buyback_total_tokens').notNull(),
  rank: integer('rank').notNull(),
  rankedAt: text('ranked_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('perf_rankings_agent_id_idx').on(table.agentId),
  index('perf_rankings_ranked_at_idx').on(table.rankedAt),
]);

// ─── Relations ──────────────────────────────────────────
export const agentsRelations = relations(agents, ({ many }) => ({
  trades: many(trades),
  annotations: many(tradeAnnotations),
  contexts: many(agentContext),
  tokenSnapshots: many(tokenSnapshots),
  rankings: many(performanceRankings),
}));

export const tradesRelations = relations(trades, ({ one, many }) => ({
  agent: one(agents, {
    fields: [trades.agentId],
    references: [agents.id],
  }),
  annotations: many(tradeAnnotations),
}));

export const tradeAnnotationsRelations = relations(tradeAnnotations, ({ one }) => ({
  trade: one(trades, {
    fields: [tradeAnnotations.tradeId],
    references: [trades.id],
  }),
  agent: one(agents, {
    fields: [tradeAnnotations.agentId],
    references: [agents.id],
  }),
}));

export const agentContextRelations = relations(agentContext, ({ one }) => ({
  agent: one(agents, {
    fields: [agentContext.agentId],
    references: [agents.id],
  }),
}));

export const tokenSnapshotsRelations = relations(tokenSnapshots, ({ one }) => ({
  agent: one(agents, {
    fields: [tokenSnapshots.agentId],
    references: [agents.id],
  }),
}));

export const performanceRankingsRelations = relations(performanceRankings, ({ one }) => ({
  agent: one(agents, {
    fields: [performanceRankings.agentId],
    references: [agents.id],
  }),
}));
