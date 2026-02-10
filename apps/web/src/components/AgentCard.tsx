import { Link } from 'react-router-dom';
import { TrendingUp, TrendingDown, Activity, DollarSign, RotateCcw } from 'lucide-react';
import { formatUsd, formatPercent, formatAddress, getAgentAvatar } from '../lib/formatters';

interface AgentCardProps {
  ranking: {
    rank: number;
    agentId: string;
    agentName?: string;
    agentAvatarUrl?: string | null;
    agentWalletAddress?: string;
    totalPnlUsd: string;
    winRate: string;
    totalTrades: number;
    totalVolumeUsd: string;
    tokenPriceChange24h: string;
    buybackTotalSol: string;
  };
  isNew?: boolean;
}

export function AgentCard({ ranking, isNew = false }: AgentCardProps) {
  const pnl = parseFloat(ranking.totalPnlUsd);
  const rank = ranking.rank;

  const getRankBadgeClass = () => {
    if (rank === 1) return 'rank-badge-1';
    if (rank === 2) return 'rank-badge-2';
    if (rank === 3) return 'rank-badge-3';
    return 'rank-badge-other';
  };

  return (
    <Link
      to={`/agent/${ranking.agentId}`}
      className={`
        cyber-card cyber-card-hover p-5 block relative overflow-hidden
        ${isNew ? 'animate-shake' : ''}
      `}
    >
      {/* New Badge */}
      {isNew && (
        <div className="absolute top-3 right-3 px-2 py-1 bg-[#FF2E8C] text-white text-xs font-bold rounded-full animate-pulse">
          NEW
        </div>
      )}

      {/* Header */}
      <div className="flex items-start gap-4 mb-4">
        {/* Rank Badge */}
        <div className={`
          w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0
          ${getRankBadgeClass()}
        `}>
          {rank}
        </div>

        {/* Avatar */}
        <div className="relative shrink-0">
          <img
            src={getAgentAvatar(ranking.agentId, ranking.agentAvatarUrl)}
            alt={ranking.agentName ?? ''}
            className="w-14 h-14 rounded-lg object-cover border border-white/10"
          />
          {rank <= 3 && (
            <div className={`
              absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-xs
              ${rank === 1 ? 'bg-[#B6FF2E]' : rank === 2 ? 'bg-[#2ED0FF]' : 'bg-white'}
            `}>
              {rank === 1 ? '\u{1F451}' : rank === 2 ? '\u{1F948}' : '\u{1F949}'}
            </div>
          )}
        </div>

        {/* Name & Address */}
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-white truncate text-lg">{ranking.agentName ?? 'Unknown'}</h3>
          <p className="mono text-xs text-[#A8A8A8] truncate">
            {formatAddress(ranking.agentWalletAddress || '')}
          </p>
        </div>
      </div>

      {/* P&L Display */}
      <div className="mb-4">
        <div className={`
          text-2xl font-bold flex items-center gap-2
          ${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}
        `}>
          {pnl >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
          {pnl >= 0 ? '+' : ''}{formatUsd(pnl)}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`
            text-sm font-medium
            ${parseFloat(ranking.tokenPriceChange24h) >= 0 ? 'text-emerald-400' : 'text-rose-400'}
          `}>
            {formatPercent(ranking.tokenPriceChange24h)}
          </span>
          <span className="text-xs text-[#A8A8A8]">24h change</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3">
        <StatItem
          icon={<Activity className="w-3.5 h-3.5" />}
          label="Win Rate"
          value={`${parseFloat(ranking.winRate).toFixed(0)}%`}
        />
        <StatItem
          icon={<DollarSign className="w-3.5 h-3.5" />}
          label="Trades"
          value={ranking.totalTrades.toString()}
        />
        <StatItem
          icon={<RotateCcw className="w-3.5 h-3.5" />}
          label="Volume"
          value={formatUsd(parseFloat(ranking.totalVolumeUsd)).replace('$', '')}
        />
      </div>

      {/* Buyback Badge */}
      {parseFloat(ranking.buybackTotalSol) > 0 && (
        <div className="mt-4 pt-3 border-t border-white/5">
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 bg-[#B6FF2E]/20 text-[#B6FF2E] rounded-full font-medium">
              BUYBACK
            </span>
            <span className="text-[#A8A8A8]">
              {parseFloat(ranking.buybackTotalSol).toFixed(2)} SOL
            </span>
          </div>
        </div>
      )}

      {/* Sparkline Background */}
      <div className="absolute bottom-0 left-0 right-0 h-16 opacity-10 pointer-events-none">
        <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          <path
            d={generateSparklinePath()}
            fill="none"
            stroke={pnl >= 0 ? '#10B981' : '#F43F5E'}
            strokeWidth="2"
          />
        </svg>
      </div>
    </Link>
  );
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-[#A8A8A8] mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="font-semibold text-white text-sm">{value}</p>
    </div>
  );
}

function generateSparklinePath(): string {
  const points = [];
  const numPoints = 20;
  let y = 50;

  for (let i = 0; i < numPoints; i++) {
    const x = (i / (numPoints - 1)) * 100;
    y += (Math.random() - 0.5) * 20;
    y = Math.max(10, Math.min(90, y));
    points.push(`${x},${y}`);
  }

  return `M ${points.join(' L ')}`;
}
