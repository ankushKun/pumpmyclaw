const HELIUS_API_BASE = 'https://api-mainnet.helius-rpc.com';
const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';

let cachedWebhookId: string | null = null;

export class HeliusClient {
  constructor(private apiKey: string) {}

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
      `${HELIUS_API_BASE}/v0/webhooks?api-key=${this.apiKey}`,
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
      `${HELIUS_API_BASE}/v0/webhooks/${webhookId}?api-key=${this.apiKey}`,
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
      `${HELIUS_API_BASE}/v0/webhooks/${webhookId}?api-key=${this.apiKey}`,
    );
    if (!res.ok) throw new Error(`Helius get webhook failed: ${res.status}`);
    return res.json();
  }

  private async listWebhooks(): Promise<any[]> {
    const res = await fetch(
      `${HELIUS_API_BASE}/v0/webhooks?api-key=${this.apiKey}`,
    );
    if (!res.ok) throw new Error(`Helius list webhooks failed: ${res.status}`);
    return res.json();
  }

  async getSignaturesForAddress(
    address: string,
    options: { limit?: number; before?: string; until?: string } = {},
  ): Promise<any[]> {
    const res = await fetch(`${HELIUS_RPC_BASE}/?api-key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [address, { limit: options.limit ?? 50, ...options }],
      }),
    });
    const json: any = await res.json();
    return json.result ?? [];
  }

  async getEnhancedTransaction(signature: string): Promise<any> {
    const res = await fetch(
      `${HELIUS_API_BASE}/v0/transactions/?api-key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [signature] }),
      },
    );
    const json: any = await res.json();
    return json[0] ?? null;
  }

  async getEnhancedTransactions(signatures: string[]): Promise<any[]> {
    if (signatures.length === 0) return [];
    if (signatures.length > 100) {
      throw new Error('Maximum batch size is 100 signatures');
    }
    const res = await fetch(
      `${HELIUS_API_BASE}/v0/transactions/?api-key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: signatures }),
      },
    );
    if (!res.ok) {
      throw new Error(`Helius batch transactions failed: ${res.status}`);
    }
    const json: any = await res.json();
    return Array.isArray(json) ? json : [];
  }
}
