-- Migration: Add multi-chain support
-- Phase 1: Additive changes (backward compatible)

-- Create agent_wallets table
CREATE TABLE `agent_wallets` (
  `id` text PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  `agent_id` text NOT NULL,
  `chain` text NOT NULL DEFAULT 'solana',
  `wallet_address` text NOT NULL,
  `token_address` text,
  `created_at` text NOT NULL DEFAULT (datetime('now')),
  `updated_at` text NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `agent_wallets_unique_idx` ON `agent_wallets` (`agent_id`, `chain`, `wallet_address`);
CREATE INDEX `agent_wallets_wallet_idx` ON `agent_wallets` (`wallet_address`);
CREATE INDEX `agent_wallets_agent_chain_idx` ON `agent_wallets` (`agent_id`, `chain`);

-- Add new columns to trades table
ALTER TABLE `trades` ADD COLUMN `wallet_id` text REFERENCES `agent_wallets`(`id`);
ALTER TABLE `trades` ADD COLUMN `chain` text NOT NULL DEFAULT 'solana';
ALTER TABLE `trades` ADD COLUMN `token_in_address` text;
ALTER TABLE `trades` ADD COLUMN `token_out_address` text;
ALTER TABLE `trades` ADD COLUMN `base_asset_price_usd` text;

-- Create new composite unique index for trades (chain + txSignature)
DROP INDEX IF EXISTS `trades_tx_sig_idx`;
CREATE UNIQUE INDEX `trades_tx_sig_chain_idx` ON `trades` (`tx_signature`, `chain`);
CREATE INDEX `trades_wallet_id_idx` ON `trades` (`wallet_id`);
CREATE INDEX `trades_chain_idx` ON `trades` (`chain`);

-- Add new columns to token_snapshots table
ALTER TABLE `token_snapshots` ADD COLUMN `chain` text NOT NULL DEFAULT 'solana';
ALTER TABLE `token_snapshots` ADD COLUMN `token_address` text;
CREATE INDEX `token_snapshots_chain_idx` ON `token_snapshots` (`chain`);

-- Add new columns to token_metadata table
ALTER TABLE `token_metadata` ADD COLUMN `chain` text NOT NULL DEFAULT 'solana';
ALTER TABLE `token_metadata` ADD COLUMN `address` text;

-- Create new composite unique index for token_metadata (chain + address)
-- Note: SQLite doesn't support adding constraints to existing tables easily
-- We'll handle this with a unique index instead
CREATE UNIQUE INDEX IF NOT EXISTS `token_metadata_chain_address_idx` ON `token_metadata` (`chain`, `address`);

-- Add new columns to performance_rankings table
ALTER TABLE `performance_rankings` ADD COLUMN `buyback_total_base_asset` text;

-- Backfill agent_wallets from existing agents
-- This will be done at runtime via a script, not in the migration
-- to avoid blocking the migration
