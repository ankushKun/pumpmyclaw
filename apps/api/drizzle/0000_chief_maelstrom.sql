CREATE TABLE "agent_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"wallet_address" text NOT NULL,
	"token_mint_address" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_wallet_address_unique" UNIQUE("wallet_address")
);
--> statement-breakpoint
CREATE TABLE "performance_rankings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"total_pnl_usd" numeric NOT NULL,
	"win_rate" numeric NOT NULL,
	"total_trades" integer NOT NULL,
	"total_volume_usd" numeric NOT NULL,
	"token_price_change_24h" numeric NOT NULL,
	"buyback_total_sol" numeric NOT NULL,
	"buyback_total_tokens" numeric NOT NULL,
	"rank" integer NOT NULL,
	"ranked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"mint_address" text NOT NULL,
	"price_usd" numeric NOT NULL,
	"market_cap_usd" numeric NOT NULL,
	"holder_count" integer,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"strategy" text,
	"notes" text,
	"tags" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"tx_signature" text NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"platform" text NOT NULL,
	"trade_type" text NOT NULL,
	"token_in_mint" text NOT NULL,
	"token_in_amount" numeric NOT NULL,
	"token_out_mint" text NOT NULL,
	"token_out_amount" numeric NOT NULL,
	"sol_price_usd" numeric NOT NULL,
	"trade_value_usd" numeric NOT NULL,
	"is_buyback" boolean DEFAULT false NOT NULL,
	"raw_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_tx_signature_unique" UNIQUE("tx_signature")
);
--> statement-breakpoint
ALTER TABLE "agent_context" ADD CONSTRAINT "agent_context_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_rankings" ADD CONSTRAINT "performance_rankings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_snapshots" ADD CONSTRAINT "token_snapshots_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_annotations" ADD CONSTRAINT "trade_annotations_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_annotations" ADD CONSTRAINT "trade_annotations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_context_agent_id_idx" ON "agent_context" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_wallet_idx" ON "agents" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "perf_rankings_agent_id_idx" ON "performance_rankings" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "perf_rankings_ranked_at_idx" ON "performance_rankings" USING btree ("ranked_at");--> statement-breakpoint
CREATE INDEX "token_snapshots_agent_id_idx" ON "token_snapshots" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "token_snapshots_snapshot_at_idx" ON "token_snapshots" USING btree ("snapshot_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_tx_sig_idx" ON "trades" USING btree ("tx_signature");--> statement-breakpoint
CREATE INDEX "trades_agent_id_idx" ON "trades" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "trades_block_time_idx" ON "trades" USING btree ("block_time");--> statement-breakpoint
CREATE INDEX "trades_agent_buyback_idx" ON "trades" USING btree ("agent_id","is_buyback");