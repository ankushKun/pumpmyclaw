import { TrendingUp, Percent, Activity, DollarSign, RotateCcw, Clock } from 'lucide-react';
import { formatUsd, formatPercent } from '../lib/formatters';

interface StatsCardsProps {
  ranking: {
    totalPnlUsd: string;
    winRate: string;
    totalTrades: number;
    totalVolumeUsd: string;
    tokenPriceChange24h: string;
    buybackTotalSol: string;
    buybackTotalTokens?: string;
  };
}

export function StatsCards({ ranking }: StatsCardsProps) {
  const stats = [
    {
      icon: <TrendingUp className="w-5 h-5" />,
      label: 'Total P&L',
      value: formatUsd(parseFloat(ranking.totalPnlUsd)),
      change: `${parseFloat(ranking.tokenPriceChange24h) >= 0 ? '+' : ''}${ranking.tokenPriceChange24h}%`,
      positive: parseFloat(ranking.totalPnlUsd) >= 0,
    },
    {
      icon: <Percent className="w-5 h-5" />,
      label: 'Win Rate',
      value: `${parseFloat(ranking.winRate).toFixed(0)}%`,
      change: `${ranking.totalTrades} trades`,
      positive: parseFloat(ranking.winRate) >= 50,
    },
    {
      icon: <Activity className="w-5 h-5" />,
      label: 'Total Trades',
      value: ranking.totalTrades.toString(),
      change: 'All time',
      positive: true,
    },
    {
      icon: <DollarSign className="w-5 h-5" />,
      label: 'Volume',
      value: formatUsd(parseFloat(ranking.totalVolumeUsd)),
      change: 'Lifetime',
      positive: true,
    },
    {
      icon: <RotateCcw className="w-5 h-5" />,
      label: 'Buyback SOL',
      value: `${parseFloat(ranking.buybackTotalSol).toFixed(2)} SOL`,
      change: ranking.buybackTotalTokens
        ? `${parseFloat(ranking.buybackTotalTokens).toLocaleString()} tokens`
        : '',
      positive: parseFloat(ranking.buybackTotalSol) > 0,
    },
    {
      icon: <Clock className="w-5 h-5" />,
      label: 'Token 24h',
      value: formatPercent(ranking.tokenPriceChange24h),
      change: 'Price change',
      positive: parseFloat(ranking.tokenPriceChange24h) >= 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {stats.map((stat, index) => (
        <div
          key={stat.label}
          className="cyber-card p-4 cyber-card-hover animate-slide-in"
          style={{ animationDelay: `${index * 0.1}s` }}
        >
          <div className="flex items-center gap-2 text-[#A8A8A8] mb-2">
            {stat.icon}
            <span className="text-xs uppercase tracking-wider">{stat.label}</span>
          </div>
          <p className={`
            text-xl md:text-2xl font-bold mb-1
            ${stat.positive ? 'text-white' : 'text-rose-400'}
          `}>
            {stat.value}
          </p>
          {stat.change && (
            <p className={`
              text-xs
              ${stat.positive ? 'text-emerald-400' : 'text-rose-400'}
            `}>
              {stat.change}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
