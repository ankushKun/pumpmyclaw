import { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, ExternalLink, TrendingUp, TrendingDown,
  MessageSquare, Target, Shield, Wallet,
} from 'lucide-react';
import { api, type TokenStats, type AgentWallet } from '../lib/api';
import { TokenChart } from '../components/TokenChart';
import { StatsCards } from '../components/StatsCards';
import { TradeTable } from '../components/TradeTable';
import { Skeleton } from '../components/Skeleton';
import {
  formatUsd,
  formatPercent,
  formatAddress,
  formatCompactUsd,
  explorerWalletUrl,
  explorerTokenUrl,
  getAgentAvatar,
} from '../lib/formatters';

type Chain = 'solana' | 'monad';

function formatTokenPrice(price: string | number): string {
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (p === 0) return '$0';
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  const str = p.toFixed(10);
  const match = str.match(/^0\.(0*)(\d{2,4})/);
  if (match) {
    const zeros = match[1].length;
    const digits = match[2].slice(0, 4);
    return `$0.0\u2080${String(zeros).split('').map(d => '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'[parseInt(d)]).join('')}${digits}`;
  }
  return `$${p.toPrecision(4)}`;
}

function useRelativeTime(timestamp: Date | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timestamp) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [timestamp]);
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export function AgentProfile() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<'trades' | 'buybacks' | 'context'>('trades');
  const [selectedChain, setSelectedChain] = useState<Chain>('solana');

  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.getAgent(id!),
    enabled: !!id,
  });

  const { data: walletsRes, isLoading: walletsLoading } = useQuery({
    queryKey: ['agent-wallets', id],
    queryFn: () => api.getAgentWallets(id!),
    enabled: !!id,
  });

  const wallets = walletsRes?.data ?? [];
  const currentWallet = wallets.find(w => w.chain === selectedChain);

  // Auto-select first available chain
  useEffect(() => {
    if (wallets.length > 0 && !currentWallet) {
      setSelectedChain(wallets[0].chain);
    }
  }, [wallets, currentWallet]);

  const { data: trades, isLoading: tradesLoading, dataUpdatedAt: tradesUpdatedAt, isFetching: tradesFetching } = useQuery({
    queryKey: ['agent-trades', id, selectedChain],
    queryFn: () => api.getAgentTrades(id!, 1, 100, selectedChain),
    enabled: !!id,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: chartData } = useQuery({
    queryKey: ['agent-chart', id, selectedChain],
    queryFn: () => api.getAgentChart(id!, selectedChain),
    enabled: !!id && !!currentWallet?.tokenAddress,
    refetchInterval: 60_000,
  });

  const { data: rankings } = useQuery({
    queryKey: ['rankings'],
    queryFn: api.getRankings,
    refetchInterval: 30_000,
  });

  const { data: contexts } = useQuery({
    queryKey: ['agent-context', id],
    queryFn: () => api.getAgentContext(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  // Only fetch token stats if current wallet has a token address
  const { data: tokenStatsRes } = useQuery({
    queryKey: ['agent-token-stats', currentWallet?.tokenAddress, selectedChain],
    queryFn: () => currentWallet?.tokenAddress ? api.getAgentTokenStats(id!, selectedChain) : Promise.resolve(null),
    enabled: !!id && !!currentWallet?.tokenAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const lastUpdated = tradesUpdatedAt ? new Date(tradesUpdatedAt) : null;
  const relativeTime = useRelativeTime(lastUpdated);

  // Derive data (must be before early returns to satisfy Rules of Hooks)
  const a = agent?.data;
  const agentRanking = rankings?.data?.find((r) => r.agentId === id);
  const allTrades = trades?.data ?? [];
  const contextList = contexts?.data ?? [];
  const pnl = agentRanking ? parseFloat(agentRanking.totalPnlUsd) : 0;
  const isPositive = pnl >= 0;
  const tokenStats: TokenStats | null = tokenStatsRes?.data ?? null;

  // Calculate chain-specific stats from trades (for accurate per-chain display)
  const chainSpecificStats = useMemo(() => {
    if (!agentRanking) return null;

    const chainTrades = allTrades.filter(t => t.chain === selectedChain);
    const buybacks = chainTrades.filter(t => t.isBuyback);

    const buybackTotalSol = buybacks.reduce((sum, t) => {
      const decimals = t.chain === 'monad' ? 1e18 : 1e9;
      return sum + parseFloat(t.tokenInAmount) / decimals;
    }, 0);

    const buybackTotalTokens = buybacks.reduce((sum, t) => {
      const decimals = t.chain === 'monad' ? 1e18 : 1e9;
      return sum + parseFloat(t.tokenOutAmount) / decimals;
    }, 0);

    return {
      ...agentRanking,
      buybackTotalSol: buybackTotalSol.toString(),
      buybackTotalTokens: buybackTotalTokens.toString(),
    };
  }, [agentRanking, allTrades, selectedChain]);

  if (agentLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-6">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-6">
          <Skeleton className="w-24 h-24 !rounded-xl" />
          <div className="space-y-3 flex-1">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
        <Skeleton className="h-[350px] w-full" />
      </div>
    );
  }

  if (!a) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#A8A8A8] mb-4">Agent not found</p>
          <Link to="/" className="btn-primary">
            Back to Leaderboard
          </Link>
        </div>
      </div>
    );
  }

  const filteredTrades = activeTab === 'buybacks'
    ? allTrades.filter((t: any) => t.isBuyback)
    : allTrades;

  return (
    <div className="min-h-[calc(100vh-4rem)] pb-20">
      {/* Hero Section */}
      <section className="relative py-12 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial from-[#2ED0FF]/10 via-transparent to-transparent" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Back Button */}
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-[#A8A8A8] hover:text-white transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Leaderboard
          </Link>

          <div className="grid lg:grid-cols-3 gap-8">
            {/* Agent Info */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-start gap-6">
                {/* Avatar */}
                <div className="relative shrink-0">
                  <img
                    src={getAgentAvatar(id!, a.avatarUrl)}
                    alt={a.name}
                    className="w-24 h-24 md:w-32 md:h-32 rounded-xl object-cover border-2 border-[#B6FF2E]/30"
                  />
                  {agentRanking && (
                    <div className={`
                      absolute -bottom-2 -right-2 w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold
                      ${agentRanking.rank === 1 ? 'bg-[#B6FF2E] text-black' :
                        agentRanking.rank === 2 ? 'bg-[#2ED0FF] text-black' :
                        agentRanking.rank === 3 ? 'bg-white text-black' : 'bg-white/10 text-white border border-white/30'}
                    `}>
                      #{agentRanking.rank}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h1 className="text-3xl md:text-4xl font-black text-white mb-3 truncate">
                    {a.name}
                  </h1>

                  {/* Chain Tabs - Only show if agent has multiple chain wallets */}
                  {wallets.length > 1 && (
                    <div className="flex gap-2 mb-3">
                      {wallets.map((wallet) => (
                        <button
                          key={wallet.id}
                          onClick={() => setSelectedChain(wallet.chain)}
                          className={`
                            px-4 py-1.5 rounded-lg text-sm font-medium transition-all
                            ${selectedChain === wallet.chain
                              ? 'bg-[#B6FF2E] text-black font-bold'
                              : 'bg-white/10 text-[#A8A8A8] hover:bg-white/20 hover:text-white'
                            }
                          `}
                        >
                          {wallet.chain === 'solana' ? '◎ Solana' : '◈ Monad'}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Wallet Address */}
                  {currentWallet && (
                    <a
                      href={explorerWalletUrl(currentWallet.walletAddress, currentWallet.chain)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-[#2ED0FF] hover:text-[#B6FF2E] transition-colors mb-2"
                    >
                      <span className="mono text-sm">{formatAddress(currentWallet.walletAddress)}</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}

                  {/* Token Address */}
                  {currentWallet?.tokenAddress && (
                    <a
                      href={explorerTokenUrl(currentWallet.tokenAddress, currentWallet.chain)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-4 inline-flex items-center gap-2 text-[#A8A8A8] hover:text-[#2ED0FF] transition-colors"
                    >
                      <span className="mono text-sm">Token: {formatAddress(currentWallet.tokenAddress)}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}

                  {a.bio && (
                    <p className="text-[#A8A8A8] max-w-xl mt-2">{a.bio}</p>
                  )}
                </div>
              </div>

              {/* P&L Display */}
              {agentRanking && (
                <div className="cyber-card p-6 inline-block">
                  <p className="text-sm text-[#A8A8A8] mb-1">Total P&L</p>
                  <div className={`
                    text-4xl md:text-5xl font-black flex items-center gap-3
                    ${isPositive ? 'pnl-positive' : 'pnl-negative'}
                  `}>
                    {isPositive ? <TrendingUp className="w-8 h-8" /> : <TrendingDown className="w-8 h-8" />}
                    {isPositive ? '+' : ''}{formatUsd(pnl)}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`
                      text-sm font-medium
                      ${parseFloat(agentRanking.tokenPriceChange24h) >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                    `}>
                      {formatPercent(agentRanking.tokenPriceChange24h)}
                    </span>
                    <span className="text-xs text-[#A8A8A8]">24h change</span>
                  </div>
                </div>
              )}
            </div>

            {/* Token Stats Sidebar */}
            <div className="space-y-4">
              {tokenStats && (
                <div className="cyber-card p-5">
                  <h3 className="text-sm font-medium text-[#A8A8A8] uppercase tracking-wider mb-4">
                    Token Stats
                  </h3>
                  <div className="space-y-4">
                    <StatRow label="Price" value={formatTokenPrice(tokenStats.priceUsd)} />
                    <StatRow label="Market Cap" value={formatCompactUsd(tokenStats.marketCap)} />
                    <StatRow label="Liquidity" value={formatCompactUsd(tokenStats.liquidity)} />
                    <StatRow label="Volume (24h)" value={formatCompactUsd(tokenStats.volume24h)} />
                    <StatRow
                      label="1h Change"
                      value={tokenStats.priceChange1h !== null ? formatPercent(tokenStats.priceChange1h) : '\u2014'}
                      positive={tokenStats.priceChange1h !== null ? tokenStats.priceChange1h >= 0 : undefined}
                    />
                    <StatRow
                      label="24h Change"
                      value={tokenStats.priceChange24h !== null ? formatPercent(tokenStats.priceChange24h) : '\u2014'}
                      positive={tokenStats.priceChange24h !== null ? tokenStats.priceChange24h >= 0 : undefined}
                    />
                  </div>
                </div>
              )}

              {/* Trade on pump.fun/nad.fun CTA */}
              {currentWallet?.tokenAddress && (
                <a
                  href={
                    selectedChain === 'monad'
                      ? `https://nad.fun/tokens/${currentWallet.tokenAddress}`
                      : `https://pump.fun/coin/${currentWallet.tokenAddress}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cyber-card p-4 flex items-center justify-between hover:border-[#B6FF2E]/30 transition-colors group block"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#B6FF2E]/10 flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-[#B6FF2E]" />
                    </div>
                    <div>
                      <p className="font-medium text-white">
                        Trade on {selectedChain === 'monad' ? 'nad.fun' : 'pump.fun'}
                      </p>
                      <p className="text-xs text-[#A8A8A8]">Buy/sell this agent&apos;s token</p>
                    </div>
                  </div>
                  <ExternalLink className="w-5 h-5 text-[#A8A8A8] group-hover:text-[#B6FF2E] transition-colors" />
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Chart Section */}
      {a.tokenMintAddress && (
        <section className="py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-white mb-1">Price Chart</h2>
              <p className="text-sm text-[#A8A8A8]">Token candlestick chart</p>
            </div>
            {chartData?.data && chartData.data.length > 0 ? (
              <TokenChart data={chartData.data} height={350} />
            ) : (
              <div className="cyber-card h-[350px] flex items-center justify-center text-[#A8A8A8] text-sm">
                {chartData === undefined ? 'Loading chart...' : 'No chart data available'}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Stats Cards */}
      {chainSpecificStats && (
        <section className="py-8">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <StatsCards ranking={chainSpecificStats} chain={selectedChain} />
          </div>
        </section>
      )}

      {/* Activity Feed */}
      <section className="py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Tabs */}
          <div className="flex items-center gap-2 mb-6 border-b border-white/10">
            <TabButton
              active={activeTab === 'trades'}
              onClick={() => setActiveTab('trades')}
              icon={<TrendingUp className="w-4 h-4" />}
            >
              All Trades
            </TabButton>
            <TabButton
              active={activeTab === 'buybacks'}
              onClick={() => setActiveTab('buybacks')}
              icon={<TrendingUp className="w-4 h-4" />}
            >
              Buybacks
            </TabButton>
            <TabButton
              active={activeTab === 'context'}
              onClick={() => setActiveTab('context')}
              icon={<MessageSquare className="w-4 h-4" />}
            >
              Agent Context
            </TabButton>
            {relativeTime && (
              <span className="ml-auto text-xs text-[#A8A8A8] flex items-center gap-1.5 pb-3">
                {tradesFetching && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#B6FF2E] animate-pulse" />
                )}
                updated {relativeTime}
              </span>
            )}
          </div>

          {/* Content */}
          {activeTab === 'context' ? (
            <ContextFeed context={contextList} />
          ) : tradesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <TradeTable trades={filteredTrades} chain={selectedChain} />
          )}
        </div>
      </section>
    </div>
  );
}

function StatRow({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#A8A8A8]">{label}</span>
      <span className={`
        text-sm font-medium
        ${positive === undefined ? 'text-white' : positive ? 'text-emerald-400' : 'text-rose-400'}
      `}>
        {value}
      </span>
    </div>
  );
}

function TabButton({
  children,
  active,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
        ${active
          ? 'border-[#B6FF2E] text-[#B6FF2E]'
          : 'border-transparent text-[#A8A8A8] hover:text-white'
        }
      `}
    >
      {icon}
      {children}
    </button>
  );
}

function ContextFeed({ context }: { context: any[] }) {
  const getIcon = (type: string) => {
    switch (type) {
      case 'target_price': return <Target className="w-4 h-4" />;
      case 'stop_loss': return <Shield className="w-4 h-4" />;
      case 'portfolio_update': return <Wallet className="w-4 h-4" />;
      case 'strategy_update': return <TrendingUp className="w-4 h-4" />;
      default: return <MessageSquare className="w-4 h-4" />;
    }
  };

  const getColor = (type: string) => {
    switch (type) {
      case 'target_price': return 'text-emerald-400 bg-emerald-400/10';
      case 'stop_loss': return 'text-rose-400 bg-rose-400/10';
      case 'portfolio_update': return 'text-[#2ED0FF] bg-[#2ED0FF]/10';
      case 'strategy_update': return 'text-[#B6FF2E] bg-[#B6FF2E]/10';
      default: return 'text-white bg-white/10';
    }
  };

  if (context.length === 0) {
    return (
      <div className="cyber-card p-8 text-center">
        <p className="text-[#A8A8A8]">No context entries yet</p>
      </div>
    );
  }

  return (
    <div className="cyber-card divide-y divide-white/5">
      {context.map((item: any, index: number) => {
        const ctxData = item.data as Record<string, unknown>;
        const parts: string[] = [];
        if (ctxData.message) parts.push(String(ctxData.message));
        else if (ctxData.description) parts.push(String(ctxData.description));
        else if (ctxData.action) parts.push(String(ctxData.action));
        else if (ctxData.strategy) parts.push(String(ctxData.strategy));
        if (ctxData.reason) parts.push(String(ctxData.reason));
        if (ctxData.token && ctxData.targetPrice) {
          parts.push(`${ctxData.token} target: $${ctxData.targetPrice}`);
        }
        const description = parts.length > 0
          ? parts.join(' \u2014 ')
          : item.contextType.replace(/_/g, ' ');

        return (
          <div
            key={item.id}
            className="p-4 hover:bg-white/5 transition-colors animate-slide-in"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className="flex items-start gap-4">
              <div className={`
                w-10 h-10 rounded-lg flex items-center justify-center shrink-0
                ${getColor(item.contextType)}
              `}>
                {getIcon(item.contextType)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`
                    text-xs font-medium uppercase tracking-wider
                    ${getColor(item.contextType).split(' ')[0]}
                  `}>
                    {item.contextType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-[#A8A8A8]">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-white">{description}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
