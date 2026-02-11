CREATE TABLE `agent_context` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`context_type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_context_agent_id_idx` ON `agent_context` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`bio` text,
	`avatar_url` text,
	`wallet_address` text NOT NULL,
	`token_mint_address` text,
	`api_key_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_wallet_address_unique` ON `agents` (`wallet_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `agents_wallet_idx` ON `agents` (`wallet_address`);--> statement-breakpoint
CREATE TABLE `performance_rankings` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`total_pnl_usd` text NOT NULL,
	`win_rate` text NOT NULL,
	`total_trades` integer NOT NULL,
	`total_volume_usd` text NOT NULL,
	`token_price_change_24h` text NOT NULL,
	`buyback_total_sol` text NOT NULL,
	`buyback_total_tokens` text NOT NULL,
	`rank` integer NOT NULL,
	`ranked_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `perf_rankings_agent_id_idx` ON `performance_rankings` (`agent_id`);--> statement-breakpoint
CREATE INDEX `perf_rankings_ranked_at_idx` ON `performance_rankings` (`ranked_at`);--> statement-breakpoint
CREATE TABLE `token_metadata` (
	`mint` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`decimals` integer DEFAULT 6 NOT NULL,
	`logo_url` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `token_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`mint_address` text NOT NULL,
	`price_usd` text NOT NULL,
	`market_cap_usd` text NOT NULL,
	`holder_count` integer,
	`snapshot_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `token_snapshots_agent_id_idx` ON `token_snapshots` (`agent_id`);--> statement-breakpoint
CREATE INDEX `token_snapshots_snapshot_at_idx` ON `token_snapshots` (`snapshot_at`);--> statement-breakpoint
CREATE TABLE `trade_annotations` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`strategy` text,
	`notes` text,
	`tags` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `trades`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`tx_signature` text NOT NULL,
	`block_time` text NOT NULL,
	`platform` text NOT NULL,
	`trade_type` text NOT NULL,
	`token_in_mint` text NOT NULL,
	`token_in_amount` text NOT NULL,
	`token_out_mint` text NOT NULL,
	`token_out_amount` text NOT NULL,
	`sol_price_usd` text NOT NULL,
	`trade_value_usd` text NOT NULL,
	`is_buyback` integer DEFAULT false NOT NULL,
	`raw_data` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_tx_signature_unique` ON `trades` (`tx_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `trades_tx_sig_idx` ON `trades` (`tx_signature`);--> statement-breakpoint
CREATE INDEX `trades_agent_id_idx` ON `trades` (`agent_id`);--> statement-breakpoint
CREATE INDEX `trades_block_time_idx` ON `trades` (`block_time`);--> statement-breakpoint
CREATE INDEX `trades_agent_buyback_idx` ON `trades` (`agent_id`,`is_buyback`);