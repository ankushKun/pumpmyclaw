export function formatUsd(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatPercent(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0.0%';
  return `${num >= 0 ? '+' : ''}${num.toFixed(1)}%`;
}

export function formatAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

export function formatNumber(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  return new Intl.NumberFormat('en-US').format(num);
}

// Solana explorers
export function explorerTxUrl(signature: string): string {
  return `https://orb.helius.dev/tx/${signature}`;
}

export function explorerWalletUrl(address: string): string {
  return `https://orbmarkets.io/address/${address}`;
}

export function explorerTokenUrl(mint: string): string {
  return `https://dexscreener.com/solana/${mint}`;
}

// Monad explorers (support testnet toggle)
const MONAD_EXPLORER_MAINNET = 'https://monadexplorer.com';
const MONAD_EXPLORER_TESTNET = 'https://testnet.monadscan.com';

export function monadExplorerTxUrl(hash: string, testnet = false): string {
  const base = testnet ? MONAD_EXPLORER_TESTNET : MONAD_EXPLORER_MAINNET;
  return `${base}/tx/${hash}`;
}

export function monadExplorerWalletUrl(address: string, testnet = false): string {
  const base = testnet ? MONAD_EXPLORER_TESTNET : MONAD_EXPLORER_MAINNET;
  return `${base}/address/${address}`;
}

export function monadTokenUrl(address: string): string {
  return `https://nad.fun/token/${address}`;
}

/** Detect if an address is EVM (0x-prefixed, 42 chars) vs Solana (base58) */
export function isEvmAddress(address: string): boolean {
  return address.startsWith('0x') && address.length === 42;
}

export function formatCompactUsd(value: number | string): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0.00';
  if (Math.abs(num) >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (Math.abs(num) >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  if (Math.abs(num) >= 1) return `$${num.toFixed(2)}`;
  return `$${num.toFixed(6)}`;
}

const AGENT_AVATARS = [
  '/agent-01.jpg', '/agent-02.jpg', '/agent-03.jpg', '/agent-04.jpg',
  '/agent-05.jpg', '/agent-06.jpg', '/agent-07.jpg', '/agent-08.jpg',
  '/agent-09.jpg', '/agent-10.jpg', '/agent-11.jpg', '/agent-12.jpg',
];

export function getAgentAvatar(agentId: string, avatarUrl?: string | null): string {
  if (avatarUrl) return avatarUrl;
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_AVATARS[Math.abs(hash) % AGENT_AVATARS.length];
}

export function formatTimeAgo(isoStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
