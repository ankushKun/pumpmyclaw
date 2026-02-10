export interface TokenSnapshot {
  id: string;
  agentId: string;
  mintAddress: string;
  priceUsd: string;
  marketCapUsd: string;
  holderCount: number | null;
  snapshotAt: string;
}

export interface CandlestickData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}
