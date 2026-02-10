import {
  group,
  test,
  assertEqual,
  assertExists,
  assertShape,
  assert,
  assertArray,
  request,
  state,
} from './helpers';

export async function runTradeTests() {
  group('Trade Endpoints');

  await test('GET /api/trades/agent/:id — returns paginated trades', async () => {
    const { status, body } = await request(
      `/api/trades/agent/${state.agentId}`,
    );
    assertEqual(status, 200, 'status');
    assertEqual(body.success, true, 'success');
    assertArray(body.data, 'data');
    assert(body.data.length >= 2, `expected >= 2 trades, got ${body.data.length}`);
    assertExists(body.meta, 'meta');
    assertEqual(body.meta.page, 1, 'page');
    assertEqual(body.meta.limit, 50, 'default limit');
  });

  await test('GET /api/trades/agent/:id — pagination works', async () => {
    const { body } = await request(
      `/api/trades/agent/${state.agentId}?page=1&limit=1`,
    );
    assertEqual(body.data.length, 1, 'limit=1 returns 1 trade');
    assertEqual(body.meta.page, 1, 'page');
    assertEqual(body.meta.limit, 1, 'limit');
  });

  await test('GET /api/trades/agent/:id — limit is capped at 100', async () => {
    const { body } = await request(
      `/api/trades/agent/${state.agentId}?limit=999`,
    );
    assertEqual(body.meta.limit, 100, 'limit capped at 100');
  });

  await test('GET /api/trades/agent/:id — trades ordered by blockTime desc', async () => {
    const { body } = await request(
      `/api/trades/agent/${state.agentId}`,
    );
    if (body.data.length >= 2) {
      const times = body.data.map((t: any) => new Date(t.blockTime).getTime());
      for (let i = 1; i < times.length; i++) {
        assert(
          times[i - 1] >= times[i],
          `trades should be ordered desc: ${times[i - 1]} >= ${times[i]}`,
        );
      }
    }
  });

  await test('GET /api/trades/agent/:id — empty for non-existent agent', async () => {
    const { body } = await request(
      '/api/trades/agent/00000000-0000-0000-0000-000000000000',
    );
    assertEqual(body.success, true, 'success');
    assertEqual(body.data.length, 0, 'empty');
  });

  group('Trade Annotations');

  await test('POST /api/trades/:sig/annotate — annotates a verified trade', async () => {
    const { status, body } = await request(
      `/api/trades/${state.regularTradeSig}/annotate`,
      {
        method: 'POST',
        headers: { 'X-API-Key': state.apiKey },
        body: {
          strategy: 'momentum',
          notes: 'Bought USDC as a hedge',
          tags: ['hedge', 'usdc'],
        },
      },
    );
    assertEqual(status, 201, 'status');
    assertEqual(body.success, true, 'success');
    assertShape(body.data, {
      id: 'string',
      tradeId: 'string',
      agentId: 'string',
      strategy: 'string|null',
      notes: 'string|null',
      createdAt: 'string',
    }, 'annotation');
    assertEqual(body.data.strategy, 'momentum', 'strategy');
    assertEqual(body.data.notes, 'Bought USDC as a hedge', 'notes');
    assertEqual(body.data.agentId, state.agentId, 'agentId');
  });

  await test('POST /api/trades/:sig/annotate — rejects without auth', async () => {
    const { status } = await request(
      `/api/trades/${state.regularTradeSig}/annotate`,
      {
        method: 'POST',
        body: { notes: 'no auth' },
      },
    );
    assertEqual(status, 401, 'status');
  });

  await test('POST /api/trades/:sig/annotate — 404 for non-existent trade', async () => {
    const { status, body } = await request(
      '/api/trades/nonexistent_signature_xyz/annotate',
      {
        method: 'POST',
        headers: { 'X-API-Key': state.apiKey },
        body: { notes: 'should fail' },
      },
    );
    assertEqual(status, 404, 'status');
    assertEqual(body.error, 'Trade not found', 'error');
  });

  await test('POST /api/trades/:sig/annotate — 403 for other agent\'s trade', async () => {
    // Agent2 tries to annotate Agent1's trade
    const { status, body } = await request(
      `/api/trades/${state.regularTradeSig}/annotate`,
      {
        method: 'POST',
        headers: { 'X-API-Key': state.agent2ApiKey },
        body: { notes: 'not my trade' },
      },
    );
    assertEqual(status, 403, 'status');
    assertEqual(body.error, 'Trade does not belong to this agent', 'error');
  });

  await test('POST /api/trades/:sig/annotate — minimal annotation (only notes)', async () => {
    const { status, body } = await request(
      `/api/trades/${state.regularTradeSig}/annotate`,
      {
        method: 'POST',
        headers: { 'X-API-Key': state.apiKey },
        body: { notes: 'Just a note' },
      },
    );
    assertEqual(status, 201, 'status');
    assertEqual(body.data.notes, 'Just a note', 'notes');
    assertEqual(body.data.strategy, null, 'strategy should be null');
  });
}
