import { Link } from 'react-router-dom';
import { formatUsd, formatPercent, formatAddress } from '../lib/formatters';

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

const RANK_BADGES: Record<number, { label: string; color: string }> = {
  1: { label: '#1', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  2: { label: '#2', color: 'bg-gray-400/20 text-gray-300 border-gray-400/30' },
  3: { label: '#3', color: 'bg-amber-600/20 text-amber-500 border-amber-600/30' },
};

export function AgentCard({ ranking: r, isNew = false }: AgentCardProps) {
  const pnl = parseFloat(r.totalPnlUsd);
  const priceChange = parseFloat(r.tokenPriceChange24h);
  const badge = RANK_BADGES[r.rank];

  return (
    <Link
      to={`/agent/${r.agentId}`}
      className={`bg-gray-900 border rounded-xl overflow-hidden hover:border-gray-700 hover:bg-gray-900/80 transition group ${
        isNew ? 'animate-agent-shake border-green-500/50' : 'border-gray-800'
      }`}
    >
      {/* Card top: avatar area */}
      <div className="relative h-32 bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
        {r.agentAvatarUrl ? (
          <img
            src={r.agentAvatarUrl}
            alt={r.agentName ?? ''}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-5xl font-bold text-gray-700 group-hover:text-gray-600 transition">
            {(r.agentName ?? '?')[0].toUpperCase()}
          </div>
        )}
        {/* Rank badge */}
        {badge && (
          <span className={`absolute top-2 left-2 text-xs font-bold px-2 py-0.5 rounded border ${badge.color}`}>
            {badge.label}
          </span>
        )}
        {!badge && (
          <span className="absolute top-2 left-2 text-xs font-bold px-2 py-0.5 rounded border bg-gray-800/80 text-gray-500 border-gray-700">
            #{r.rank}
          </span>
        )}
        {/* P&L change pill */}
        <span className={`absolute top-2 right-2 text-xs font-bold px-2 py-0.5 rounded ${
          pnl >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {pnl >= 0 ? '+' : ''}{formatUsd(pnl)}
        </span>
        {isNew && (
          <span className="absolute bottom-2 left-2 text-xs font-bold px-2 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">
            NEW
          </span>
        )}
      </div>

      {/* Card body */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <h3 className="text-white font-semibold truncate text-sm">{r.agentName ?? 'Unknown'}</h3>
            {r.agentWalletAddress && (
              <div className="text-xs text-gray-600 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                {formatAddress(r.agentWalletAddress, 4)}
              </div>
            )}
          </div>
          <span className={`text-xs font-bold shrink-0 ${
            priceChange >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {formatPercent(priceChange)}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mt-2">
          <span>Vol {formatUsd(r.totalVolumeUsd)}</span>
          <span className="text-gray-700">&middot;</span>
          <span>{r.totalTrades} trades</span>
          <span className="text-gray-700">&middot;</span>
          <span>WR {parseFloat(r.winRate).toFixed(0)}%</span>
        </div>

        {/* Buyback indicator */}
        {parseFloat(r.buybackTotalSol) > 0 && (
          <div className="mt-2 text-xs text-yellow-500/80">
            {parseFloat(r.buybackTotalSol).toFixed(2)} SOL buyback
          </div>
        )}
      </div>
    </Link>
  );
}
