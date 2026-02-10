import {
  group,
  test,
  assertEqual,
  assertExists,
  assertShape,
  assert,
  request,
  state,
} from './helpers';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'pmc-webhook-secret-k8x2m9';

function makeSwapPayload(overrides: Record<string, any> = {}) {
  return {
    type: 'SWAP',
    source: 'JUPITER',
    signature: overrides.signature ?? `test_sig_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    timestamp: overrides.timestamp ?? Math.floor(Date.now() / 1000),
    feePayer: overrides.feePayer ?? '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    accountData: [],
    events: {
      swap: {
        nativeInput: overrides.nativeInput ?? {
          account: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
          amount: '2000000000',
        },
        nativeOutput: overrides.nativeOutput ?? null,
        tokenInputs: overrides.tokenInputs ?? [],
        tokenOutputs: overrides.tokenOutputs ?? [
          {
            userAccount: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
            mint: overrides.outputMint ?? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            rawTokenAmount: {
              tokenAmount: overrides.outputAmount ?? '300000000',
              decimals: 6,
            },
          },
        ],
        innerSwaps: [
          {
            programInfo: {
              source: overrides.dex ?? 'JUPITER',
              account: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
              programName: overrides.dex ?? 'JUPITER',
              instructionName: 'route',
            },
          },
        ],
      },
    },
  };
}

export async function runWebhookTests() {
  group('Webhook Authentication');

  await test('POST /webhooks/helius — rejects missing auth', async () => {
    const { status, body } = await request('/webhooks/helius', {
      method: 'POST',
      body: [makeSwapPayload()],
    });
    assertEqual(status, 401, 'status');
    assertEqual(body.error, 'Unauthorized', 'error');
  });

  await test('POST /webhooks/helius — rejects wrong auth', async () => {
    const { status, body } = await request('/webhooks/helius', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
      body: [makeSwapPayload()],
    });
    assertEqual(status, 401, 'status');
    assertEqual(body.error, 'Unauthorized', 'error');
  });

  group('Webhook Trade Ingestion');

  await test('POST /webhooks/helius — ingests regular SOL->Token swap', async () => {
    const sig = `regular_trade_${Date.now()}`;
    state.regularTradeSig = sig;

    const { status, body } = await request('/webhooks/helius', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
      body: [
        makeSwapPayload({
          signature: sig,
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        }),
      ],
    });
    assertEqual(status, 200, 'status');
    assertEqual(body.received, true, 'received');
  });

  await test('Verify regular trade stored in DB', async () => {
    // Small delay for async processing
    await new Promise((r) => setTimeout(r, 500));
    const { body } = await request(
      `/api/trades/agent/${state.agentId}`,
    );
    const trade = body.data.find(
      (t: any) => t.txSignature === state.regularTradeSig,
    );
    assertExists(trade, 'trade in response');
    assertEqual(trade.platform, 'JUPITER', 'platform');
    assertEqual(trade.isBuyback, false, 'isBuyback should be false');
    assertEqual(
      trade.tokenInMint,
      'So11111111111111111111111111111111111111112',
      'tokenInMint should be SOL',
    );
    assertEqual(
      trade.tokenOutMint,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'tokenOutMint',
    );
    assertExists(trade.rawData, 'rawData preserved');
    state.regularTradeId = trade.id;
  });

  await test('Verify trade response shape', async () => {
    const { body } = await request(
      `/api/trades/agent/${state.agentId}`,
    );
    const trade = body.data.find(
      (t: any) => t.txSignature === state.regularTradeSig,
    );
    assertShape(trade, {
      id: 'string',
      agentId: 'string',
      txSignature: 'string',
      blockTime: 'string',
      platform: 'string',
      tradeType: 'string',
      tokenInMint: 'string',
      tokenInAmount: 'string',
      tokenOutMint: 'string',
      tokenOutAmount: 'string',
      solPriceUsd: 'string',
      tradeValueUsd: 'string',
      isBuyback: 'boolean',
      createdAt: 'string',
    }, 'trade shape');
  });

  group('Webhook Buyback Detection');

  await test('POST /webhooks/helius — detects buyback (agent buys own token)', async () => {
    const sig = `buyback_${Date.now()}`;
    state.buybackSig = sig;

    const { status, body } = await request('/webhooks/helius', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
      body: [
        makeSwapPayload({
          signature: sig,
          // Agent's own token mint as output = buyback
          outputMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
          outputAmount: '50000000000',
          nativeInput: {
            account: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
            amount: '500000000',
          },
          dex: 'RAYDIUM',
        }),
      ],
    });
    assertEqual(status, 200, 'status');
    assertEqual(body.received, true, 'received');
  });

  await test('Verify buyback trade has isBuyback=true', async () => {
    await new Promise((r) => setTimeout(r, 500));
    const { body } = await request(
      `/api/trades/agent/${state.agentId}`,
    );
    const buyback = body.data.find(
      (t: any) => t.txSignature === state.buybackSig,
    );
    assertExists(buyback, 'buyback trade');
    assertEqual(buyback.isBuyback, true, 'isBuyback');
    assertEqual(buyback.tradeType, 'buy', 'tradeType');
    assertEqual(buyback.platform, 'RAYDIUM', 'platform');
    assertEqual(
      buyback.tokenOutMint,
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      'tokenOutMint should be agent token',
    );
  });

  await test('GET /buybacks — returns only buyback trades', async () => {
    const { body } = await request(
      `/api/trades/agent/${state.agentId}/buybacks`,
    );
    assertEqual(body.success, true, 'success');
    assert(body.data.length >= 1, 'should have at least 1 buyback');
    for (const trade of body.data) {
      assertEqual(trade.isBuyback, true, `trade ${trade.txSignature} isBuyback`);
    }
  });

  group('Webhook Deduplication');

  await test('POST /webhooks/helius — duplicate tx_signature is ignored', async () => {
    const { status } = await request('/webhooks/helius', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
      body: [
        makeSwapPayload({
          signature: state.regularTradeSig, // Same sig as before
        }),
      ],
    });
    assertEqual(status, 200, 'status');

    // Count trades — should NOT increase
    const { body } = await request(
      `/api/trades/agent/${state.agentId}`,
    );
    const matches = body.data.filter(
      (t: any) => t.txSignature === state.regularTradeSig,
    );
    assertEqual(matches.length, 1, 'should have exactly 1 trade with this sig');
  });

  group('Webhook Edge Cases');

  await test('POST /webhooks/helius — ignores tx from unknown wallet', async () => {
    const { status, body } = await request('/webhooks/helius', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
      body: [
        makeSwapPayload({
          signature: `unknown_wallet_${Date.now()}`,
          feePayer: 'UnknownWalletNotRegistered1111111111111111',
        }),
      ],
    });
    assertEqual(status, 200, 'status');
    assertEqual(body.received, true, 'still returns received');
  });

  await test('POST /webhooks/helius — handles multi-tx batch', async () => {
    const sig1 = `batch_1_${Date.now()}`;
    const sig2 = `batch_2_${Date.now()}`;

    const { status } = await request('/webhooks/helius', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
      body: [
        makeSwapPayload({ signature: sig1 }),
        makeSwapPayload({ signature: sig2 }),
      ],
    });
    assertEqual(status, 200, 'status');

    await new Promise((r) => setTimeout(r, 500));
    const { body } = await request(
      `/api/trades/agent/${state.agentId}`,
    );
    const found1 = body.data.find((t: any) => t.txSignature === sig1);
    const found2 = body.data.find((t: any) => t.txSignature === sig2);
    assertExists(found1, 'batch trade 1');
    assertExists(found2, 'batch trade 2');
  });

  await test('POST /webhooks/helius — trades for agent2 go to agent2', async () => {
    const sig = `agent2_trade_${Date.now()}`;
    state.agent2TradeSig = sig;

    await request('/webhooks/helius', {
      method: 'POST',
      headers: { Authorization: `Bearer ${WEBHOOK_SECRET}` },
      body: [
        makeSwapPayload({
          signature: sig,
          feePayer: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
        }),
      ],
    });

    await new Promise((r) => setTimeout(r, 500));

    // Should appear in agent2's trades
    const { body: agent2Trades } = await request(
      `/api/trades/agent/${state.agent2Id}`,
    );
    const found = agent2Trades.data.find(
      (t: any) => t.txSignature === sig,
    );
    assertExists(found, 'trade in agent2 list');
    assertEqual(found.agentId, state.agent2Id, 'agentId matches agent2');

    // Should NOT appear in agent1's trades
    const { body: agent1Trades } = await request(
      `/api/trades/agent/${state.agentId}`,
    );
    const notFound = agent1Trades.data.find(
      (t: any) => t.txSignature === sig,
    );
    assertEqual(notFound, undefined, 'trade should not be in agent1 list');
  });
}
