const HELIUS_API_BASE = 'https://api-mainnet.helius-rpc.com';
const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';
const SOLANA_PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

let cachedWebhookId: string | null = null;

export class HeliusClient {
  private apiKeys: string[];

  constructor(primaryKey: string, fallbackKeys?: string[]) {
    this.apiKeys = [primaryKey, ...(fallbackKeys ?? [])].filter(Boolean);
  }

  async addWalletToWebhook(
    walletAddress: string,
    webhookSecret: string,
  ): Promise<void> {
    if (cachedWebhookId) {
      const current = await this.getWebhook(cachedWebhookId);
      const addresses = [...new Set([...current.accountAddresses, walletAddress])];
      await this.updateWebhook(cachedWebhookId, addresses);
    } else {
      const webhooks = await this.listWebhooks();
      const existing = webhooks.find(
        (w: any) => w.webhookURL?.includes('pumpmyclaw'),
      );

      if (existing) {
        cachedWebhookId = existing.webhookID;
        const addresses = [
          ...new Set([...existing.accountAddresses, walletAddress]),
        ];
        await this.updateWebhook(existing.webhookID, addresses);
      } else {
        const created = await this.createWebhook(
          [walletAddress],
          webhookSecret,
        );
        cachedWebhookId = created.webhookID;
      }
    }
  }

  private async createWebhook(
    accountAddresses: string[],
    webhookSecret: string,
  ): Promise<any> {
    const res = await fetch(
      `${HELIUS_API_BASE}/v0/webhooks?api-key=${this.apiKeys[0]}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookURL: 'https://api.pumpmyclaw.fun/webhooks/helius',
          transactionTypes: ['SWAP'],
          accountAddresses,
          webhookType: 'enhanced',
          authHeader: `Bearer ${webhookSecret}`,
        }),
      },
    );
    if (!res.ok) throw new Error(`Helius create webhook failed: ${res.status}`);
    return res.json();
  }

  private async updateWebhook(
    webhookId: string,
    accountAddresses: string[],
  ): Promise<any> {
    const res = await fetch(
      `${HELIUS_API_BASE}/v0/webhooks/${webhookId}?api-key=${this.apiKeys[0]}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountAddresses }),
      },
    );
    if (!res.ok) throw new Error(`Helius update webhook failed: ${res.status}`);
    return res.json();
  }

  private async getWebhook(webhookId: string): Promise<any> {
    const res = await fetch(
      `${HELIUS_API_BASE}/v0/webhooks/${webhookId}?api-key=${this.apiKeys[0]}`,
    );
    if (!res.ok) throw new Error(`Helius get webhook failed: ${res.status}`);
    return res.json();
  }

  private async listWebhooks(): Promise<any[]> {
    const res = await fetch(
      `${HELIUS_API_BASE}/v0/webhooks?api-key=${this.apiKeys[0]}`,
    );
    if (!res.ok) throw new Error(`Helius list webhooks failed: ${res.status}`);
    return res.json();
  }

  async getSignaturesForAddress(
    address: string,
    options: { limit?: number; before?: string; until?: string } = {},
  ): Promise<any[]> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [address, { limit: options.limit ?? 50, ...options }],
    });

    // Try each Helius key, then Solana public RPC as last resort
    const endpoints = [
      ...this.apiKeys.map((k) => `${HELIUS_RPC_BASE}/?api-key=${k}`),
      SOLANA_PUBLIC_RPC,
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });

        if (res.status === 429) {
          await res.body?.cancel();
          continue;
        }

        if (!res.ok) {
          await res.body?.cancel();
          continue;
        }

        const json: any = await res.json();
        if (json.error) {
          continue;
        }
        return json.result ?? [];
      } catch {
        continue;
      }
    }

    console.error(`getSignaturesForAddress failed on all endpoints for ${address}`);
    return [];
  }

  async getEnhancedTransaction(signature: string): Promise<any> {
    for (const key of this.apiKeys) {
      const res = await fetch(
        `${HELIUS_API_BASE}/v0/transactions/?api-key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions: [signature] }),
        },
      );
      if (res.status === 429) {
        await res.body?.cancel();
        continue;
      }
      const json: any = await res.json();
      return json[0] ?? null;
    }
    console.error(`getEnhancedTransaction failed for ${signature}`);
    return null;
  }

  async getEnhancedTransactions(signatures: string[]): Promise<any[]> {
    if (signatures.length === 0) return [];
    if (signatures.length > 100) {
      throw new Error('Maximum batch size is 100 signatures');
    }

    for (const key of this.apiKeys) {
      const res = await fetch(
        `${HELIUS_API_BASE}/v0/transactions/?api-key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactions: signatures }),
        },
      );

      if (res.status === 429) {
        await res.body?.cancel();
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel();
        continue;
      }
      const json: any = await res.json();
      return Array.isArray(json) ? json : [];
    }

    console.error(`getEnhancedTransactions exhausted all keys for ${signatures.length} sigs`);
    return [];
  }
}
