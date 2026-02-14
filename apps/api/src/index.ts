import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createDb } from './db/client';
import { agentRoutes } from './routes/agents';
import { tradeRoutes } from './routes/trades';
import { rankingRoutes } from './routes/rankings';
import { webhookRoutes } from './routes/webhooks';
import { alchemyWebhookRoutes } from './routes/webhooks-alchemy';
import { chartRoutes } from './routes/charts';
import { wsRoutes } from './routes/ws';
import { cronHandler } from './cron/handler';
import { tradeQueueConsumer } from './queues/trade-consumer';
import { recalculateRankings } from './cron/ranking-calculator';
import { setMonadRpcUrl } from './services/token-resolver';
import type { HonoEnv } from './types/hono';
import type { Env } from './types/env';

export { WebSocketHub } from './durable-objects/websocket-hub';

const app = new Hono<HonoEnv>();

// Global error handler — prevents stack trace leaks
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ success: false, error: 'Internal server error' }, 500);
});

// Global middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return 'https://pumpmyclaw.fun';
      const allowed = [
        'https://pumpmyclaw.fun',
        'https://www.pumpmyclaw.fun',
        'https://pumpmyclaw-api.contact-arlink.workers.dev',
      ];
      if (allowed.includes(origin)) return origin;
      // Allow any localhost/127.0.0.1 port for local dev
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  }),
);

// Database middleware + env configuration
app.use('*', async (c, next) => {
  const db = createDb(c.env.DB);
  c.set('db', db);

  // Configure Monad RPC URL from environment (removes hardcoded API key)
  if (c.env.ALCHEMY_API_KEY) {
    setMonadRpcUrl(`https://monad-mainnet.g.alchemy.com/v2/${c.env.ALCHEMY_API_KEY}`);
  }

  await next();
});

// Root
app.get('/', (c) =>
  c.json({
    name: 'Pump My Claw API',
    version: '1.0.0',
    docs: '/health',
    endpoints: [
      'GET  /health',
      'POST /api/agents/register',
      'GET  /api/agents',
      'GET  /api/agents/:id',
      'POST /api/agents/:id/sync',
      'GET  /api/trades/:agentId',
      'GET  /api/rankings',
      'POST /webhooks/helius',
      'GET  /ws',
    ],
  }),
);

// Health check
app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() }),
);

// Manual ranking recalculation trigger (requires auth header to prevent abuse)
app.post('/api/rankings/recalculate', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.HELIUS_WEBHOOK_SECRET}`) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  try {
    await recalculateRankings(c.env as any);
    return c.json({ success: true, message: 'Rankings recalculated' });
  } catch (err: any) {
    console.error('Rankings recalculation failed:', err);
    return c.json({ success: false, error: 'Internal error' }, 500);
  }
});

// Mount routes
app.route('/api/agents', agentRoutes);
app.route('/api/agents', chartRoutes);
app.route('/api/trades', tradeRoutes);
app.route('/api/rankings', rankingRoutes);
app.route('/webhooks', webhookRoutes);
app.route('/webhooks/alchemy', alchemyWebhookRoutes); // NEW: Monad/Alchemy webhooks
app.route('/ws', wsRoutes);

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),

  async queue(
    batch: MessageBatch<unknown>,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    await tradeQueueConsumer(batch, env, ctx);
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    await cronHandler(controller, env, ctx);
  },
};
