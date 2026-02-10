import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── agents ─────────────────────────────────────────────
export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  bio: text('bio'),
  avatarUrl: text('avatar_url'),
  walletAddress: text('wallet_address').notNull().unique(),
  tokenMintAddress: text('token_mint_address'),
  apiKeyHash: text('api_key_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('agents_wallet_idx').on(table.walletAddress),
]);

// ─── trades ─────────────────────────────────────────────
export const trades = pgTable('trades', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  txSignature: text('tx_signature').notNull().unique(),
  blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
  platform: text('platform').notNull(),
  tradeType: text('trade_type').notNull(),
  tokenInMint: text('token_in_mint').notNull(),
  tokenInAmount: numeric('token_in_amount').notNull(),
  tokenOutMint: text('token_out_mint').notNull(),
  tokenOutAmount: numeric('token_out_amount').notNull(),
  solPriceUsd: numeric('sol_price_usd').notNull(),
  tradeValueUsd: numeric('trade_value_usd').notNull(),
  isBuyback: boolean('is_buyback').notNull().default(false),
  rawData: jsonb('raw_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('trades_tx_sig_idx').on(table.txSignature),
  index('trades_agent_id_idx').on(table.agentId),
  index('trades_block_time_idx').on(table.blockTime),
  index('trades_agent_buyback_idx').on(table.agentId, table.isBuyback),
]);

// ─── trade_annotations ──────────────────────────────────
export const tradeAnnotations = pgTable('trade_annotations', {
  id: uuid('id').defaultRandom().primaryKey(),
  tradeId: uuid('trade_id').notNull().references(() => trades.id),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  strategy: text('strategy'),
  notes: text('notes'),
  tags: text('tags').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── agent_context ──────────────────────────────────────
export const agentContext = pgTable('agent_context', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  contextType: text('context_type').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('agent_context_agent_id_idx').on(table.agentId),
]);

// ─── token_snapshots ────────────────────────────────────
export const tokenSnapshots = pgTable('token_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  mintAddress: text('mint_address').notNull(),
  priceUsd: numeric('price_usd').notNull(),
  marketCapUsd: numeric('market_cap_usd').notNull(),
  holderCount: integer('holder_count'),
  snapshotAt: timestamp('snapshot_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('token_snapshots_agent_id_idx').on(table.agentId),
  index('token_snapshots_snapshot_at_idx').on(table.snapshotAt),
]);

// ─── token_metadata (cache) ─────────────────────────────
export const tokenMetadata = pgTable('token_metadata', {
  mint: text('mint').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  decimals: integer('decimals').notNull().default(6),
  logoUrl: text('logo_url'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── performance_rankings ───────────────────────────────
export const performanceRankings = pgTable('performance_rankings', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  totalPnlUsd: numeric('total_pnl_usd').notNull(),
  winRate: numeric('win_rate').notNull(),
  totalTrades: integer('total_trades').notNull(),
  totalVolumeUsd: numeric('total_volume_usd').notNull(),
  tokenPriceChange24h: numeric('token_price_change_24h').notNull(),
  buybackTotalSol: numeric('buyback_total_sol').notNull(),
  buybackTotalTokens: numeric('buyback_total_tokens').notNull(),
  rank: integer('rank').notNull(),
  rankedAt: timestamp('ranked_at', { withTimezone: true }).defaultNow().notNull(),
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
