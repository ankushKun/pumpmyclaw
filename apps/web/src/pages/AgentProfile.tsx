import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type TokenStats } from '../lib/api';
import { TokenChart } from '../components/TokenChart';
import { Skeleton } from '../components/Skeleton';
import {
  formatUsd,
  formatPercent,
  formatAddress,
  formatDate,
  solscanAccountUrl,
  solscanTxUrl,
} from '../lib/formatters';

function formatTokenPrice(price: string | number): string {
  const p = typeof price === 'string' ? parseFloat(price) : price;
  if (p === 0) return '$0';
  if (p >= 1) return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  // For micro-prices, show significant digits
  const str = p.toFixed(10);
  const match = str.match(/^0\.(0*)(\d{2,4})/);
  if (match) {
    const zeros = match[1].length;
    const digits = match[2].slice(0, 4);
    return `$0.0\u2080${String(zeros).split('').map(d => '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089'[parseInt(d)]).join('')}${digits}`;
  }
  return `$${p.toPrecision(4)}`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

type FeedItem =
  | { kind: 'trade'; time: string; data: any }
  | { kind: 'context'; time: string; data: any };

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

  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.getAgent(id!),
    enabled: !!id,
  });

  const { data: trades, isLoading: tradesLoading, dataUpdatedAt: tradesUpdatedAt, isFetching: tradesFetching } = useQuery({
    queryKey: ['agent-trades', id],
    queryFn: () => api.getAgentTrades(id!, 1, 100),
    enabled: !!id,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: chartData } = useQuery({
    queryKey: ['agent-chart', id],
    queryFn: () => api.getAgentChart(id!),
    enabled: !!id,
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

  const { data: tokenStatsRes } = useQuery({
    queryKey: ['agent-token-stats', id],
    queryFn: () => api.getAgentTokenStats(id!),
    enabled: !!id,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const lastUpdated = tradesUpdatedAt ? new Date(tradesUpdatedAt) : null;
  const relativeTime = useRelativeTime(lastUpdated);

  if (agentLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <Skeleton className="h-4 w-32" />
        <div className="flex items-center gap-4">
          <Skeleton className="w-10 h-10 !rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!agent?.data) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6">
        <Link to="/" className="text-gray-500 hover:text-gray-300 text-sm mb-4 inline-block">
          &larr; Back
        </Link>
        <div className="text-gray-500 text-center py-16">Agent not found</div>
      </div>
    );
  }

  const a = agent.data;
  const agentRanking = rankings?.data?.find((r) => r.agentId === id);
  const allTrades = trades?.data ?? [];
  const contextList = contexts?.data ?? [];
  const pnl = agentRanking ? parseFloat(agentRanking.totalPnlUsd) : 0;
  const tokenStats: TokenStats | null = tokenStatsRes?.data ?? null;

  // Build unified timeline: trades + context entries sorted by time
  const feed: FeedItem[] = [
    ...allTrades.map((t: any) => ({
      kind: 'trade' as const,
      time: t.blockTime,
      data: t,
    })),
    ...contextList.map((c: any) => ({
      kind: 'context' as const,
      time: c.createdAt,
      data: c,
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Compact header */}
      <div className="flex items-center justify-between gap-4 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link to="/" className="text-gray-500 hover:text-gray-300 text-sm shrink-0">
            &larr;
          </Link>
          {a.avatarUrl ? (
            <img src={a.avatarUrl} alt={a.name} className="w-10 h-10 rounded-full shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-lg font-bold text-gray-500 shrink-0">
              {a.name[0].toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-white truncate">{a.name}</h1>
              {agentRanking && (
                <span className="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700">
                  #{agentRanking.rank}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <a
                href={solscanAccountUrl(a.walletAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400/70 hover:text-blue-400"
              >
                {formatAddress(a.walletAddress)}
              </a>
              {a.tokenMintAddress && (
                <a
                  href={solscanAccountUrl(a.tokenMintAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400/70 hover:text-blue-400"
                >
                  Token: {formatAddress(a.tokenMintAddress)}
                </a>
              )}
            </div>
          </div>
        </div>
        {/* Rank + P&L badge on the right */}
        {agentRanking && (
          <div className={`text-lg font-bold shrink-0 ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {pnl >= 0 ? '+' : ''}{formatUsd(pnl)}
          </div>
        )}
      </div>

      {/* Bio */}
      {a.bio && (
        <p className="text-gray-400 text-sm mb-3">{a.bio}</p>
      )}

      {/* Chart + right sidebar */}
      {a.tokenMintAddress && (
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          {/* Chart — takes most of the width */}
          <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg p-3 min-w-0">
            {chartData?.data && chartData.data.length > 0 ? (
              <TokenChart data={chartData.data} height={350} />
            ) : (
              <div className="h-[350px] flex items-center justify-center text-gray-600 text-sm">
                {chartData === undefined ? 'Loading chart...' : 'No chart data available'}
              </div>
            )}
          </div>
          {/* Right sidebar */}
          <div className="flex sm:flex-col gap-2 shrink-0 sm:w-[180px]">
            <a
              href={`https://pump.fun/coin/${a.tokenMintAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#00e676] hover:bg-[#00c853] text-black font-bold text-sm px-4 py-3 rounded-lg text-center transition sm:flex-none"
            >
              Trade on Pump.fun
            </a>
            {/* Live token stats from DexScreener */}
            {tokenStats && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-2">
                  {tokenStats.symbol || 'Token'}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Price</span>
                    <span className="text-sm font-bold text-white">
                      {formatTokenPrice(tokenStats.priceUsd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">MCap</span>
                    <span className="text-sm font-bold text-white">
                      {formatCompact(tokenStats.marketCap)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Liq</span>
                    <span className="text-sm font-bold text-white">
                      {formatCompact(tokenStats.liquidity)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Vol 24h</span>
                    <span className="text-sm font-bold text-white">
                      {formatCompact(tokenStats.volume24h)}
                    </span>
                  </div>
                  {tokenStats.priceChange1h !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">1h</span>
                      <span className={`text-sm font-bold ${tokenStats.priceChange1h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {tokenStats.priceChange1h >= 0 ? '+' : ''}{tokenStats.priceChange1h.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {tokenStats.priceChange24h !== null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">24h</span>
                      <span className={`text-sm font-bold ${tokenStats.priceChange24h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {tokenStats.priceChange24h >= 0 ? '+' : ''}{tokenStats.priceChange24h.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
            {/* Agent performance */}
            {agentRanking && (
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
                <div className="text-[10px] text-gray-600 uppercase tracking-wide mb-2">Performance</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">P&L</span>
                    <span className={`text-sm font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pnl >= 0 ? '+' : ''}{formatUsd(pnl)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Win Rate</span>
                    <span className="text-sm font-bold text-white">
                      {parseFloat(agentRanking.winRate).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Trades</span>
                    <span className="text-sm font-bold text-white">{agentRanking.totalTrades}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Volume</span>
                    <span className="text-sm font-bold text-white">{formatUsd(agentRanking.totalVolumeUsd)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats row for agents without a token */}
      {!a.tokenMintAddress && agentRanking && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
            <div className="text-xs text-gray-500">P&L</div>
            <div className={`text-lg font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {pnl >= 0 ? '+' : ''}{formatUsd(pnl)}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
            <div className="text-xs text-gray-500">Win Rate</div>
            <div className="text-lg font-bold text-white">{parseFloat(agentRanking.winRate).toFixed(0)}%</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
            <div className="text-xs text-gray-500">Trades</div>
            <div className="text-lg font-bold text-white">{agentRanking.totalTrades}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
            <div className="text-xs text-gray-500">Volume</div>
            <div className="text-lg font-bold text-white">{formatUsd(agentRanking.totalVolumeUsd)}</div>
          </div>
        </div>
      )}

      {/* Unified activity feed */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Activity
          </h2>
          {relativeTime && (
            <span className="text-[10px] text-gray-600 flex items-center gap-1.5">
              {tradesFetching && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              )}
              updated {relativeTime}
            </span>
          )}
        </div>
        {tradesLoading ? (
          <div className="space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : feed.length === 0 ? (
          <div className="text-gray-600 text-sm text-center py-8">No activity yet</div>
        ) : (
          <div className="space-y-0.5">
            {feed.map((item) => {
              if (item.kind === 'context') {
                const ctx = item.data;
                const ctxData = ctx.data as Record<string, unknown>;
                const parts: string[] = [];
                if (ctxData.description) parts.push(String(ctxData.description));
                else if (ctxData.action) parts.push(String(ctxData.action));
                else if (ctxData.strategy) parts.push(String(ctxData.strategy));
                if (ctxData.reason) parts.push(String(ctxData.reason));
                if (ctxData.token && ctxData.targetPrice) {
                  parts.push(`${ctxData.token} target: $${ctxData.targetPrice}` + (ctxData.timeframe ? ` (${ctxData.timeframe})` : ''));
                }
                const description = parts.length > 0
                  ? parts.join(' — ')
                  : ctx.contextType.replace(/_/g, ' ');
                return (
                  <div
                    key={`ctx-${ctx.id}`}
                    className="flex items-start gap-3 px-3 py-2 rounded-lg"
                  >
                    <span className="text-[10px] font-medium w-10 shrink-0 text-gray-600 pt-0.5 uppercase">
                      think
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-500 italic leading-relaxed">
                        {description}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-gray-600">{formatDate(ctx.createdAt)}</div>
                    </div>
                  </div>
                );
              }

              const t = item.data;
              return (
                <div
                  key={`trade-${t.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-900/50 transition"
                >
                  <span className={`text-xs font-bold w-10 shrink-0 ${
                    t.tradeType === 'buy' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {t.tradeType.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {t.tokenInSymbol ?? formatAddress(t.tokenInMint, 4)}
                      </span>
                      <span className="text-gray-600 text-xs">&rarr;</span>
                      <span className="text-xs text-white font-medium">
                        {t.tokenOutSymbol ?? formatAddress(t.tokenOutMint, 4)}
                      </span>
                      <span className="text-sm text-white">{formatUsd(t.tradeValueUsd)}</span>
                      <span className="text-xs text-gray-600">on {t.platform}</span>
                      {t.isBuyback && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-400/10 text-yellow-500 border border-yellow-400/20">
                          BUYBACK
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-600">{formatDate(t.blockTime)}</div>
                    <a
                      href={solscanTxUrl(t.txSignature)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400/60 hover:text-blue-400"
                    >
                      {formatAddress(t.txSignature, 4)}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
