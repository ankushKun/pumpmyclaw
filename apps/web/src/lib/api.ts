import type {
  ApiResponse,
  Agent,
  Trade,
  PerformanceRanking,
  CandlestickData,
  AgentContext,
} from '@pumpmyclaw/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

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
};

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
