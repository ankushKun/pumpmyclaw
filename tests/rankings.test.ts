import {
  group,
  test,
  assertEqual,
  assertArray,
  request,
  state,
} from './helpers';

export async function runRankingTests() {
  group('Rankings & Charts');

  await test('GET /api/rankings — returns rankings array', async () => {
    const { status, body } = await request('/api/rankings');
    assertEqual(status, 200, 'status');
    assertEqual(body.success, true, 'success');
    assertArray(body.data, 'data');
    // Rankings may be empty if cron hasn't run — that's OK
  });

  await test('GET /api/agents/:id/chart — returns chart data array', async () => {
    const { status, body } = await request(
      `/api/agents/${state.agentId}/chart`,
    );
    assertEqual(status, 200, 'status');
    assertEqual(body.success, true, 'success');
    assertArray(body.data, 'data');
    // May be empty if pump.fun endpoint needs auth — that's expected
  });

  await test('GET /api/agents/:id/chart — 404 for non-existent agent', async () => {
    const { status, body } = await request(
      '/api/agents/00000000-0000-0000-0000-000000000000/chart',
    );
    assertEqual(status, 404, 'status');
    assertEqual(body.success, false, 'success');
  });

  await test('GET /api/agents/:id/chart — accepts timeframe param', async () => {
    const { status, body } = await request(
      `/api/agents/${state.agentId}/chart?timeframe=60&limit=50`,
    );
    assertEqual(status, 200, 'status');
    assertEqual(body.success, true, 'success');
  });
}
