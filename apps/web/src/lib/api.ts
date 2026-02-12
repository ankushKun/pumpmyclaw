import type {
  ApiResponse,
  Agent,
  Trade,
  PerformanceRanking,
  CandlestickData,
  AgentContext,
} from '@pumpmyclaw/shared';

const LIVE_API = 'https://pumpmyclaw-api.contact-arlink.workers.dev/api';
const API_BASE = import.meta.env.VITE_API_URL ?? (import.meta.env.VITE_LOCAL === 'true' ? '/api' : LIVE_API);

// Backend API base (the Bun backend that handles auth + Docker instances)
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(
      (error as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return res.json();
}

export interface AuthUser {
  id: number;
  telegramId: string;
  username?: string;
  firstName?: string;
}

export interface Instance {
  id: number;
  userId: number;
  containerId: string;
  botUsername: string;
  model: string;
  status: string;
  createdAt: string;
}

export interface InstanceStatus {
  status: string;
  healthy: boolean;
  restartCount: number;
  exitCode: number | null;
  error: string | null;
}

export interface WalletInfo {
  address: string | null;
}

export interface WalletBalance {
  sol: number;
  formatted: string;
}

export interface WalletToken {
  mint: string;
  balance: string;
  decimals: number;
}

export interface WalletTransaction {
  signature: string;
  blockTime: number | null;
  type: string;
  success: boolean;
  solChange: string | null;
  tokenChanges: Array<{ mint: string; change: string }> | null;
}

class BackendClient {
  private token: string | null = null;
  private onAuthError: (() => void) | null = null;

  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  setAuthErrorHandler(handler: () => void) {
    this.onAuthError = handler;
  }

  private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(opts.headers as Record<string, string>),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${BACKEND_URL}${path}`, { ...opts, headers });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Unknown error' }));
      if (res.status === 401 && this.onAuthError) {
        this.onAuthError();
      }
      throw new Error(body.error || 'Request failed');
    }

    return res.json();
  }

  async loginWithTelegram(
    telegramData: Record<string, unknown>
  ): Promise<{ user: AuthUser; token: string }> {
    const { user, token } = await this.request<{ user: AuthUser; token: string }>(
      '/api/auth/telegram',
      { method: 'POST', body: JSON.stringify(telegramData) },
    );
    this.token = token;
    return { user, token };
  }

  async createInstance(config: {
    telegramBotToken: string;
    telegramBotUsername?: string;
    openrouterApiKey: string;
    model?: string;
    llmProvider?: "openrouter" | "openai-codex";
  }): Promise<Instance> {
    // Backend wraps response: { instance: { id, status, botUsername, model } }
    const res = await this.request<{ instance: Instance }>('/api/instances', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    return res.instance;
  }

  async getInstances(): Promise<Instance[]> {
    // Backend wraps response: { instances: [...] }
    const res = await this.request<{ instances: Instance[] }>('/api/instances');
    return res.instances;
  }

  async getInstanceStatus(id: number): Promise<InstanceStatus> {
    return this.request<InstanceStatus>(`/api/instances/${id}/status`);
  }

  async stopInstance(id: number): Promise<void> {
    await this.request(`/api/instances/${id}/stop`, { method: 'POST' });
  }

  async startInstance(id: number): Promise<void> {
    await this.request(`/api/instances/${id}/start`, { method: 'POST' });
  }

  async deleteInstance(id: number): Promise<void> {
    await this.request(`/api/instances/${id}`, { method: 'DELETE' });
  }

  async updateInstance(id: number, updates: { model?: string; openrouterApiKey?: string }): Promise<{ status: string; restarted: boolean }> {
    return this.request<{ status: string; restarted: boolean }>(`/api/instances/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async getInstanceLogs(id: number, lines = 200): Promise<string> {
    // Backend wraps response: { logs: "..." }
    const res = await this.request<{ logs: string }>(`/api/instances/${id}/logs?lines=${lines}`);
    return res.logs;
  }

  /**
   * Stream instance logs via SSE.
   * Backend sends: data: {"log":"..."}\n\n  or  data: {"error":"..."}\n\n  or  data: {"done":true}\n\n
   */
  streamInstanceLogs(
    id: number,
    onLine: (line: string) => void,
    onError: (error: string) => void,
    onClose: () => void,
  ): { abort: () => void } {
    const controller = new AbortController();
    const url = `${BACKEND_URL}/api/instances/${id}/logs/stream`;

    // Use fetch-based SSE since EventSource doesn't support custom auth headers
    fetch(url, {
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        onError(`HTTP ${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6);
            try {
              const data = JSON.parse(raw);
              if (data.log) {
                onLine(data.log);
              } else if (data.error) {
                onError(data.error);
              } else if (data.done) {
                onClose();
                return;
              }
            } catch {
              // If JSON parse fails, treat as raw text
              onLine(raw);
            }
          }
        }
      }
      onClose();
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err.message);
      }
    });

    return { abort: () => controller.abort() };
  }

  async getWallet(id: number): Promise<WalletInfo> {
    return this.request<WalletInfo>(`/api/instances/${id}/wallet`);
  }

  async getWalletBalance(id: number): Promise<WalletBalance> {
    return this.request<WalletBalance>(`/api/instances/${id}/wallet/balance`);
  }

  async getWalletTokens(id: number): Promise<{ tokens: WalletToken[] }> {
    return this.request<{ tokens: WalletToken[] }>(`/api/instances/${id}/wallet/tokens`);
  }

  async getWalletTransactions(id: number, limit = 20): Promise<{ transactions: WalletTransaction[] }> {
    return this.request<{ transactions: WalletTransaction[] }>(`/api/instances/${id}/wallet/transactions?limit=${limit}`);
  }

  // ── OpenAI Codex Auth (PKCE flow) ──────────────────────────────

  /** Exchange an OAuth authorization code + PKCE verifier for tokens */
  async openaiExchange(code: string, codeVerifier: string): Promise<{
    status: 'authorized';
    accountId: string | null;
    expiresAt: number;
    model: string;
  }> {
    return this.request('/api/openai-auth/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, codeVerifier }),
    });
  }

  /** Get OpenAI auth status for current user's instance */
  async openaiStatus(): Promise<{
    connected: boolean;
    provider: string | null;
    accountId: string | null;
    tokenExpires: number | null;
    expired: boolean;
  }> {
    return this.request('/api/openai-auth/status');
  }

  /** Disconnect OpenAI and revert to OpenRouter */
  async openaiDisconnect(): Promise<void> {
    await this.request('/api/openai-auth/disconnect', { method: 'POST' });
  }

  // ── Subscription / Checkout ────────────────────────────────────

  /** Public — no auth needed */
  async getSlots(): Promise<SlotsInfo> {
    const res = await fetch(`${BACKEND_URL}/api/slots`);
    if (!res.ok) throw new Error('Failed to fetch slots');
    return res.json();
  }

  /** Create a Dodo Payments checkout session. Returns the checkout URL. */
  async createCheckout(): Promise<{ checkoutUrl: string }> {
    return this.request<{ checkoutUrl: string }>('/api/checkout', {
      method: 'POST',
    });
  }

  /** Get current user's subscription status. */
  async getSubscription(): Promise<{ subscription: SubscriptionInfo | null }> {
    return this.request<{ subscription: SubscriptionInfo | null }>('/api/subscription');
  }
}

export interface SlotsInfo {
  total: number;
  taken: number;
  remaining: number;
  soldOut: boolean;
}

export interface SubscriptionInfo {
  id: number;
  status: string;
  slotNumber: number | null;
  dodoSubscriptionId: string | null;
  dodoCustomerId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export const backend = new BackendClient();

export const api = {
  getAgents: () => fetchApi<ApiResponse<Agent[]>>('/agents'),
  getAgent: (id: string) => fetchApi<ApiResponse<Agent>>(`/agents/${id}`),
  getAgentTrades: (agentId: string, page = 1, limit = 50) =>
    fetchApi<ApiResponse<Trade[]>>(
      `/trades/agent/${agentId}?page=${page}&limit=${limit}`,
    ),
  getAgentBuybacks: (agentId: string) =>
    fetchApi<ApiResponse<Trade[]>>(`/trades/agent/${agentId}/buybacks`),
  getRankings: () =>
    fetchApi<ApiResponse<PerformanceRanking[]>>('/rankings'),
  getAgentChart: (agentId: string) =>
    fetchApi<ApiResponse<CandlestickData[]>>(`/agents/${agentId}/chart`),
  getAgentContext: (agentId: string) =>
    fetchApi<ApiResponse<AgentContext[]>>(`/agents/${agentId}/context`),
  getAgentTokenStats: (agentId: string) =>
    fetchApi<ApiResponse<TokenStats | null>>(`/agents/${agentId}/token-stats`),
  getRecentTrades: (limit = 20) =>
    fetchApi<ApiResponse<RecentTrade[]>>(`/trades/recent?limit=${limit}`),
};

export interface RecentTrade {
  id: string;
  agentId: string;
  agentName: string;
  txSignature: string;
  blockTime: string;
  platform: string;
  tradeType: string;
  tokenInMint: string;
  tokenInSymbol?: string;
  tokenOutMint: string;
  tokenOutSymbol?: string;
  tradeValueUsd: string;
  isBuyback: boolean;
}

export interface TokenStats {
  priceUsd: string;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  priceChange1h: number | null;
  priceChange24h: number | null;
  symbol: string;
  name: string;
}
