import {
  group,
  test,
  assert,
  assertEqual,
  assertExists,
  assertShape,
  assertArray,
  request,
  state,
} from './helpers';

export async function runAgentTests() {
  group('Agent Registration');

  await test('POST /api/agents/register — creates agent and returns API key', async () => {
    const { status, body } = await request('/api/agents/register', {
      method: 'POST',
      body: {
        name: 'TestBot Alpha',
        bio: 'Automated test agent',
        walletAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        tokenMintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      },
    });
    assertEqual(status, 201, 'status');
    assertEqual(body.success, true, 'success');
    assertExists(body.data.agentId, 'agentId');
    assertExists(body.data.apiKey, 'apiKey');
    assert(body.data.apiKey.startsWith('pmc_'), 'apiKey should start with pmc_');
    state.agentId = body.data.agentId;
    state.apiKey = body.data.apiKey;
  });

  await test('POST /api/agents/register — second agent', async () => {
    const { status, body } = await request('/api/agents/register', {
      method: 'POST',
      body: {
        name: 'TestBot Beta',
        walletAddress: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
        tokenMintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      },
    });
    assertEqual(status, 201, 'status');
    assertEqual(body.success, true, 'success');
    state.agent2Id = body.data.agentId;
    state.agent2ApiKey = body.data.apiKey;
  });

  await test('POST /api/agents/register — rejects duplicate wallet', async () => {
    const { status, body } = await request('/api/agents/register', {
      method: 'POST',
      body: {
        name: 'Duplicate',
        walletAddress: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
        tokenMintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      },
    });
    assertEqual(status, 409, 'status');
    assertEqual(body.success, false, 'success');
    assertEqual(body.error, 'Wallet already registered', 'error message');
  });

  await test('POST /api/agents/register — rejects invalid body (missing name)', async () => {
    const { status } = await request('/api/agents/register', {
      method: 'POST',
      body: {
        walletAddress: 'SomeWallet',
        tokenMintAddress: 'SomeMint',
      },
    });
    assertEqual(status, 400, 'status');
  });

  await test('POST /api/agents/register — rejects short wallet address', async () => {
    const { status } = await request('/api/agents/register', {
      method: 'POST',
      body: {
        name: 'Bad Wallet',
        walletAddress: 'short',
        tokenMintAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      },
    });
    assertEqual(status, 400, 'status');
  });

  group('Agent CRUD');

  await test('GET /api/agents — returns list with registered agents', async () => {
    const { status, body } = await request('/api/agents');
    assertEqual(status, 200, 'status');
    assertEqual(body.success, true, 'success');
    assertArray(body.data, 'data');
    assert(body.data.length >= 2, `expected >= 2 agents, got ${body.data.length}`);
  });

  await test('GET /api/agents — response shape is correct', async () => {
    const { body } = await request('/api/agents');
    const agent = body.data.find((a: any) => a.id === state.agentId);
    assertExists(agent, 'agent in list');
    assertShape(agent, {
      id: 'string',
      name: 'string',
      bio: 'string|null',
      avatarUrl: 'string|null',
      walletAddress: 'string',
      tokenMintAddress: 'string',
      createdAt: 'string',
    }, 'agent');
    assertEqual(agent.name, 'TestBot Alpha', 'name');
    assertEqual(agent.bio, 'Automated test agent', 'bio');
  });

  await test('GET /api/agents/:id — returns specific agent', async () => {
    const { status, body } = await request(`/api/agents/${state.agentId}`);
    assertEqual(status, 200, 'status');
    assertEqual(body.success, true, 'success');
    assertShape(body.data, {
      id: 'string',
      name: 'string',
      walletAddress: 'string',
      tokenMintAddress: 'string',
      createdAt: 'string',
      updatedAt: 'string',
    }, 'agent detail');
    assertEqual(body.data.id, state.agentId, 'id');
  });

  await test('GET /api/agents/:id — 404 for non-existent agent', async () => {
    const { status, body } = await request(
      '/api/agents/00000000-0000-0000-0000-000000000000',
    );
    assertEqual(status, 404, 'status');
    assertEqual(body.success, false, 'success');
  });

  group('Agent Context (Self-Reported Data)');

  await test('POST /api/agents/context — submit strategy context', async () => {
    const { status, body } = await request('/api/agents/context', {
      method: 'POST',
      headers: { 'X-API-Key': state.apiKey },
      body: {
        contextType: 'strategy_update',
        data: { strategy: 'momentum', timeframe: '5m' },
      },
    });
    assertEqual(status, 201, 'status');
    assertEqual(body.success, true, 'success');
    assertShape(body.data, {
      id: 'string',
      agentId: 'string',
      contextType: 'string',
      data: 'object',
      createdAt: 'string',
    }, 'context');
    assertEqual(body.data.agentId, state.agentId, 'agentId');
    assertEqual(body.data.contextType, 'strategy_update', 'contextType');
  });

  await test('POST /api/agents/context — submit target price', async () => {
    const { status, body } = await request('/api/agents/context', {
      method: 'POST',
      headers: { 'X-API-Key': state.apiKey },
      body: {
        contextType: 'target_price',
        data: { targetUsd: 0.05, note: 'Expecting pump' },
      },
    });
    assertEqual(status, 201, 'status');
    assertEqual(body.data.contextType, 'target_price', 'contextType');
  });

  await test('POST /api/agents/context — rejects without API key', async () => {
    const { status } = await request('/api/agents/context', {
      method: 'POST',
      body: {
        contextType: 'strategy_update',
        data: { strategy: 'test' },
      },
    });
    assertEqual(status, 401, 'status');
  });

  await test('POST /api/agents/context — rejects invalid API key', async () => {
    const { status } = await request('/api/agents/context', {
      method: 'POST',
      headers: { 'X-API-Key': 'pmc_invalid_fake_key' },
      body: {
        contextType: 'strategy_update',
        data: { strategy: 'test' },
      },
    });
    assertEqual(status, 401, 'status');
  });

  await test('POST /api/agents/context — rejects invalid contextType', async () => {
    const { status } = await request('/api/agents/context', {
      method: 'POST',
      headers: { 'X-API-Key': state.apiKey },
      body: {
        contextType: 'invalid_type',
        data: { foo: 'bar' },
      },
    });
    assertEqual(status, 400, 'status');
  });
}
