import { ExternalLink, ArrowRightLeft, TrendingUp, TrendingDown } from 'lucide-react';
import type { Trade } from '@pumpmyclaw/shared';
import { formatUsd, formatTimeAgo, formatAddress, explorerTxUrl } from '../lib/formatters';

interface TradeTableProps {
  trades: Trade[];
  chain?: 'solana' | 'monad';
}

export function TradeTable({ trades, chain = 'solana' }: TradeTableProps) {
  if (trades.length === 0) {
    return (
      <div className="cyber-card p-8 text-center">
        <p className="text-[#A8A8A8]">No trades found</p>
      </div>
    );
  }

  return (
    <div className="cyber-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10 bg-white/5">
              <th className="text-left py-3 px-4 text-xs font-medium text-[#A8A8A8] uppercase tracking-wider">Time</th>
              <th className="text-left py-3 px-4 text-xs font-medium text-[#A8A8A8] uppercase tracking-wider">Type</th>
              <th className="text-left py-3 px-4 text-xs font-medium text-[#A8A8A8] uppercase tracking-wider">Pair</th>
              <th className="text-left py-3 px-4 text-xs font-medium text-[#A8A8A8] uppercase tracking-wider hidden sm:table-cell">Platform</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-[#A8A8A8] uppercase tracking-wider">Value</th>
              <th className="text-center py-3 px-4 text-xs font-medium text-[#A8A8A8] uppercase tracking-wider">Status</th>
              <th className="text-right py-3 px-4 text-xs font-medium text-[#A8A8A8] uppercase tracking-wider">Link</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade, index) => (
              <tr
                key={trade.id}
                className="border-b border-white/5 hover:bg-white/5 transition-colors animate-slide-in"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <td className="py-3 px-4">
                  <span className="mono text-sm text-[#A8A8A8]">
                    {formatTimeAgo(trade.blockTime)}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className={`
                    inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium
                    ${trade.tradeType === 'buy' ? 'badge-buy' : 'badge-sell'}
                  `}>
                    {trade.tradeType === 'buy' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {trade.tradeType.toUpperCase()}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {trade.tokenInSymbol || formatAddress(trade.tokenInMint, 4)}
                    </span>
                    <ArrowRightLeft className="w-3 h-3 text-[#A8A8A8]" />
                    <span className="text-sm font-medium text-white">
                      {trade.tokenOutSymbol || formatAddress(trade.tokenOutMint, 4)}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4 hidden sm:table-cell">
                  <span className="text-sm text-[#A8A8A8]">{trade.platform}</span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="text-sm font-medium text-white">
                    {formatUsd(parseFloat(trade.tradeValueUsd))}
                  </span>
                </td>
                <td className="py-3 px-4 text-center">
                  {trade.isBuyback ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-[#B6FF2E]/20 text-[#B6FF2E] rounded-full text-xs font-bold">
                      BUYBACK
                    </span>
                  ) : (
                    <span className="text-xs text-[#A8A8A8]">&mdash;</span>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  <a
                    href={explorerTxUrl(trade.txSignature, chain)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#2ED0FF] hover:text-[#B6FF2E] transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
