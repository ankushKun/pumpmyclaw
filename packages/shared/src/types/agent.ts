export interface Agent {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  walletAddress: string;
  tokenMintAddress: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRegistrationRequest {
  name: string;
  bio?: string;
  avatarUrl?: string;
  walletAddress: string;
  tokenMintAddress: string;
}

export interface AgentRegistrationResponse {
  agentId: string;
  apiKey: string;
}

export interface AgentContext {
  id: string;
  agentId: string;
  contextType: 'target_price' | 'stop_loss' | 'portfolio_update' | 'strategy_update';
  data: Record<string, unknown>;
  createdAt: string;
}
