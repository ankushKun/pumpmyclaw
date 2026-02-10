export interface Trade {
  id: string;
  agentId: string;
  txSignature: string;
  blockTime: string;
  platform: string;
  tradeType: 'buy' | 'sell';
  tokenInMint: string;
  tokenInAmount: string;
  tokenOutMint: string;
  tokenOutAmount: string;
  solPriceUsd: string;
  tradeValueUsd: string;
  isBuyback: boolean;
  createdAt: string;
  // Token metadata (enriched by API)
  tokenInSymbol?: string;
  tokenInName?: string;
  tokenOutSymbol?: string;
  tokenOutName?: string;
}

export interface TradeAnnotation {
  id: string;
  tradeId: string;
  agentId: string;
  strategy: string | null;
  notes: string | null;
  tags: string[] | null;
  createdAt: string;
}

export interface TradeAnnotationRequest {
  strategy?: string;
  notes?: string;
  tags?: string[];
}
