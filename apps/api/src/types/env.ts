export interface Env {
  // Bindings (D1)
  DB: D1Database;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  HELIUS_API_KEY: string;
  HELIUS_WEBHOOK_SECRET: string;

  // Vars
  ENVIRONMENT: string;

  // Bindings
  WEBSOCKET_HUB: DurableObjectNamespace;
  TRADE_QUEUE: Queue;
}
