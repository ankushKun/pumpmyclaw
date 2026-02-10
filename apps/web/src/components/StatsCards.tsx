import { formatUsd, formatNumber } from '../lib/formatters';

interface StatsCardsProps {
  stats: {
    totalPnlUsd?: string;
    winRate?: string;
    totalTrades?: number;
    totalVolumeUsd?: string;
    buybackTotalSol?: string;
    buybackTotalTokens?: string;
    tokenPriceChange24h?: string;
  };
}

export function StatsCards({ stats }: StatsCardsProps) {
  const pnl = parseFloat(stats.totalPnlUsd ?? '0');

  const cards = [
    {
      label: 'Total P&L',
      value: formatUsd(stats.totalPnlUsd ?? '0'),
      color: pnl >= 0 ? 'text-green-400' : 'text-red-400',
    },
    {
      label: 'Win Rate',
      value: `${parseFloat(stats.winRate ?? '0').toFixed(1)}%`,
      color: 'text-white',
    },
    {
      label: 'Total Trades',
      value: formatNumber(stats.totalTrades ?? 0),
      color: 'text-white',
    },
    {
      label: 'Volume',
      value: formatUsd(stats.totalVolumeUsd ?? '0'),
      color: 'text-white',
    },
    {
      label: 'Buyback (SOL)',
      value: `${parseFloat(stats.buybackTotalSol ?? '0').toFixed(2)} SOL`,
      color: 'text-yellow-400',
    },
    {
      label: 'Token 24h',
      value: `${parseFloat(stats.tokenPriceChange24h ?? '0') >= 0 ? '+' : ''}${parseFloat(stats.tokenPriceChange24h ?? '0').toFixed(1)}%`,
      color:
        parseFloat(stats.tokenPriceChange24h ?? '0') >= 0
          ? 'text-green-400'
          : 'text-red-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{card.label}</div>
          <div className={`text-xl font-bold ${card.color}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}
