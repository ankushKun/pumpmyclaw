import { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { formatUsd, formatTimeAgo } from '../lib/formatters';
import { api } from '../lib/api';

interface LiveTrade {
  id: string;
  agentName: string;
  tradeType: 'buy' | 'sell';
  tokenInSymbol: string;
  tokenOutSymbol: string;
  tradeValueUsd: string;
  isBuyback: boolean;
  timestamp: string;
}

interface LiveTradeFeedProps {
  maxItems?: number;
}

export function LiveTradeFeed({ maxItems = 7 }: LiveTradeFeedProps) {
  const [trades, setTrades] = useState<LiveTrade[]>([]);

  const mapRecentTrades = (data: Awaited<ReturnType<typeof api.getRecentTrades>>['data']): LiveTrade[] =>
    (data ?? []).map((t) => ({
      id: t.id,
      agentName: t.agentName || 'Unknown Agent',
      tradeType: (t.tradeType as 'buy' | 'sell') || 'buy',
      tokenInSymbol: t.tokenInSymbol || '???',
      tokenOutSymbol: t.tokenOutSymbol || '???',
      tradeValueUsd: t.tradeValueUsd || '0',
      isBuyback: t.isBuyback || false,
      timestamp: t.blockTime,
    }));

  // Seed with recent trades from REST endpoint on mount
  useEffect(() => {
    let cancelled = false;
    api.getRecentTrades(maxItems).then((res) => {
      if (cancelled) return;
      const seed = mapRecentTrades(res.data);
      if (seed.length > 0) setTrades(seed);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [maxItems]);

  // Periodic REST polling fallback (every 15s) so feed never goes stale
  useEffect(() => {
    const interval = setInterval(() => {
      api.getRecentTrades(maxItems).then((res) => {
        const fresh = mapRecentTrades(res.data);
        if (fresh.length > 0) setTrades(fresh);
      }).catch(() => {});
    }, 15_000);
    return () => clearInterval(interval);
  }, [maxItems]);

  const { isConnected } = useWebSocket({
    onMessage: (msg) => {
      if (msg.type === 'trade' && msg.data) {
        const data = msg.data as Record<string, any>;
        const newTrade: LiveTrade = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          agentName: data.agentName || 'Unknown Agent',
          tradeType: data.tradeType || 'buy',
          tokenInSymbol: data.tokenInSymbol || '???',
          tokenOutSymbol: data.tokenOutSymbol || '???',
          tradeValueUsd: data.tradeValueUsd || '0',
          isBuyback: data.isBuyback || false,
          timestamp: new Date().toISOString(),
        };
        setTrades(prev => [newTrade, ...prev.slice(0, maxItems - 1)]);
      }
    },
  });

  // Tick timer to update relative times
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  if (trades.length === 0) {
    return (
      <div className="cyber-card relative z-10">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Activity className="w-5 h-5 text-[#2ED0FF]" />
            <h3 className="font-bold text-white">LIVE FEED</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isConnected ? 'bg-[#B6FF2E]' : 'bg-[#A8A8A8]'}`}></span>
              <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isConnected ? 'bg-[#B6FF2E]' : 'bg-[#A8A8A8]'}`}></span>
            </span>
            <span className={`text-xs font-medium ${isConnected ? 'text-[#B6FF2E]' : 'text-[#A8A8A8]'}`}>
              {isConnected ? 'CONNECTED' : 'WAITING'}
            </span>
          </div>
        </div>
        <div className="p-8 text-center text-[#A8A8A8] text-sm">
          {isConnected
            ? 'Waiting for live trades...'
            : 'Connecting to live feed...'}
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-card relative z-10">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-[#2ED0FF]" />
          <h3 className="font-bold text-white">LIVE FEED</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF2E8C] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#FF2E8C]"></span>
          </span>
          <span className="text-xs text-[#FF2E8C] font-medium">STREAMING</span>
        </div>
      </div>

      {/* Trade Rows */}
      <div className="divide-y divide-white/5">
        {trades.map((trade, index) => (
          <div
            key={trade.id}
            className={`
              flex items-center justify-between p-4
              ${index === 0 ? 'bg-[#2ED0FF]/5 animate-slide-in' : 'hover:bg-white/5'}
              transition-colors
            `}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-xs font-bold text-[#A8A8A8] shrink-0">
                {trade.agentName[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{trade.agentName}</p>
                <p className="text-xs text-[#A8A8A8]">{formatTimeAgo(trade.timestamp)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4">
              <span className={`
                inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                ${trade.tradeType === 'buy' ? 'badge-buy' : 'badge-sell'}
              `}>
                {trade.tradeType === 'buy' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {trade.tradeType.toUpperCase()}
              </span>
            </div>
            <div className="hidden sm:flex items-center gap-2 px-4">
              <span className="text-sm text-white">{trade.tokenInSymbol}</span>
              <span className="text-[#A8A8A8]">&rarr;</span>
              <span className="text-sm text-white">{trade.tokenOutSymbol}</span>
            </div>
            <div className="text-right min-w-[80px]">
              <p className="text-sm font-medium text-white">{formatUsd(parseFloat(trade.tradeValueUsd))}</p>
              {trade.isBuyback && (
                <span className="text-xs text-[#B6FF2E]">BUYBACK</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
