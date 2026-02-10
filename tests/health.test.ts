import {
  group,
  test,
  assertEqual,
  assertExists,
  assertShape,
  request,
} from './helpers';

export async function runHealthTests() {
  group('Health & CORS');

  await test('GET /health — returns ok with timestamp', async () => {
    const { status, body } = await request('/health');
    assertEqual(status, 200, 'status');
    assertEqual(body.status, 'ok', 'status field');
    assertExists(body.timestamp, 'timestamp');
    // Verify timestamp is valid ISO
    const d = new Date(body.timestamp);
    assertEqual(isNaN(d.getTime()), false, 'timestamp is valid date');
  });

  await test('GET /health — has CORS headers', async () => {
    const { headers } = await request('/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    const allowOrigin = headers.get('access-control-allow-origin');
    assertExists(allowOrigin, 'access-control-allow-origin header');
  });

  await test('GET /nonexistent — returns 404', async () => {
    const { status } = await request('/nonexistent');
    assertEqual(status, 404, 'status');
  });
}
