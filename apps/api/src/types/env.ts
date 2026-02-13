export interface Env {
  // Bindings (D1)
  DB: D1Database;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;

  // Solana / Helius
  HELIUS_API_KEY: string;
  HELIUS_FALLBACK_KEYS: string; // comma-separated fallback API keys
  HELIUS_WEBHOOK_SECRET: string;

  // Monad / Alchemy
  ALCHEMY_API_KEY: string;
  ALCHEMY_WEBHOOK_SECRET: string;

  // Vars
  ENVIRONMENT: string;

  // Bindings
  WEBSOCKET_HUB: DurableObjectNamespace;
  TRADE_QUEUE: Queue;
}
