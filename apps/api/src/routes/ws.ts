import { Hono } from 'hono';
import type { HonoEnv } from '../types/hono';

export const wsRoutes = new Hono<HonoEnv>();

// GET /ws/feed — global live feed
wsRoutes.get('/feed', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }

  const hubId = c.env.WEBSOCKET_HUB.idFromName('global');
  const hub = c.env.WEBSOCKET_HUB.get(hubId);
  return hub.fetch(c.req.raw);
});

// GET /ws/agent/:id — agent-specific feed
wsRoutes.get('/agent/:id', async (c) => {
  const upgradeHeader = c.req.header('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return c.text('Expected WebSocket', 426);
  }

  const agentId = c.req.param('id');
  const hubId = c.env.WEBSOCKET_HUB.idFromName('global');
  const hub = c.env.WEBSOCKET_HUB.get(hubId);

  const url = new URL(c.req.url);
  url.searchParams.set('agentId', agentId);

  return hub.fetch(
    new Request(url.toString(), {
      headers: c.req.raw.headers,
    }),
  );
});
