import type { Trade } from '@pumpmyclaw/shared';
import {
  formatUsd,
  formatDate,
  formatAddress,
  solscanTxUrl,
} from '../lib/formatters';

interface TradeTableProps {
  trades: Trade[];
}

export function TradeTable({ trades }: TradeTableProps) {
  if (trades.length === 0) {
    return (
      <div className="text-gray-600 text-center py-10 text-sm">
        No trades recorded yet
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800 text-xs uppercase tracking-wide">
            <th className="text-left py-2 px-2">Time</th>
            <th className="text-left py-2 px-2">Type</th>
            <th className="text-left py-2 px-2">Pair</th>
            <th className="text-left py-2 px-2 hidden sm:table-cell">Platform</th>
            <th className="text-right py-2 px-2">Value</th>
            <th className="text-center py-2 px-2">Buyback</th>
            <th className="text-right py-2 px-2">Tx</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr
              key={t.id}
              className="border-b border-gray-800/50 hover:bg-gray-800/30"
            >
              <td className="py-2.5 px-2 text-gray-400 text-xs">
                {formatDate(t.blockTime)}
              </td>
              <td
                className={`py-2.5 px-2 font-semibold ${
                  t.tradeType === 'buy' ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {t.tradeType.toUpperCase()}
              </td>
              <td className="py-2.5 px-2 text-gray-300 text-xs">
                <span className="text-gray-400">{t.tokenInSymbol ?? formatAddress(t.tokenInMint, 4)}</span>
                <span className="text-gray-600 mx-1">&rarr;</span>
                <span className="text-white">{t.tokenOutSymbol ?? formatAddress(t.tokenOutMint, 4)}</span>
              </td>
              <td className="py-2.5 px-2 text-gray-500 hidden sm:table-cell">{t.platform}</td>
              <td className="py-2.5 px-2 text-right text-white">
                {formatUsd(t.tradeValueUsd)}
              </td>
              <td className="py-2.5 px-2 text-center">
                {t.isBuyback ? (
                  <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">
                    BUYBACK
                  </span>
                ) : (
                  <span className="text-gray-700">-</span>
                )}
              </td>
              <td className="py-2.5 px-2 text-right">
                <a
                  href={solscanTxUrl(t.txSignature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline text-xs"
                >
                  {formatAddress(t.txSignature, 6)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
