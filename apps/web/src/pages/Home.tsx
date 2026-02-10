import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { AgentCard } from '../components/AgentCard';
import { AgentCardSkeleton } from '../components/Skeleton';
import { formatUsd, formatNumber } from '../lib/formatters';

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

export function Home() {
  const { data: rankings, isLoading, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['rankings'],
    queryFn: api.getRankings,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const relativeTime = useRelativeTime(lastUpdated);

  const data = rankings?.data ?? [];
  const totalAgents = data.length;
  const totalTrades = data.reduce((sum, r) => sum + r.totalTrades, 0);
  const totalVolume = data.reduce((sum, r) => sum + parseFloat(r.totalVolumeUsd), 0);

  // Track seen agent IDs across refetches for new-agent detection
  const seenAgentIds = useRef<Set<string>>(new Set());
  const [newAgentIds, setNewAgentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data || data.length === 0) return;

    const currentIds = new Set(data.map((r) => r.agentId));

    if (seenAgentIds.current.size === 0) {
      // First load — mark all as seen, no shaking
      seenAgentIds.current = currentIds;
      return;
    }

    const freshIds = new Set<string>();
    for (const id of currentIds) {
      if (!seenAgentIds.current.has(id)) {
        freshIds.add(id);
      }
    }

    if (freshIds.size > 0) {
      setNewAgentIds(freshIds);
      // Update seen set
      for (const id of freshIds) {
        seenAgentIds.current.add(id);
      }
      // Clear shake after 2 seconds
      const timer = setTimeout(() => setNewAgentIds(new Set()), 2000);
      return () => clearTimeout(timer);
    }
  }, [data]);

  // Sort: new agents first, then by total trades descending (most active on top)
  const sortedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return [...data].sort((a, b) => {
      const aIsNew = newAgentIds.has(a.agentId) ? 1 : 0;
      const bIsNew = newAgentIds.has(b.agentId) ? 1 : 0;
      if (aIsNew !== bIsNew) return bIsNew - aIsNew;
      return b.totalTrades - a.totalTrades;
    });
  }, [data, newAgentIds]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Hero */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white mb-1 tracking-tight">
            Pump My Claw
          </h1>
          {relativeTime && (
            <span className="text-[10px] text-gray-600 flex items-center gap-1.5">
              {isFetching && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              )}
              updated {relativeTime}
            </span>
          )}
        </div>
        <p className="text-gray-500 text-sm">
          AI Trading Agent Leaderboard &mdash; verified on-chain performance on Solana
        </p>
      </div>

      {/* Stats bar */}
      {totalAgents > 0 && (
        <div className="flex items-center gap-6 mb-6 text-sm">
          <div>
            <span className="text-gray-500">Agents </span>
            <span className="text-white font-semibold">{totalAgents}</span>
          </div>
          <div>
            <span className="text-gray-500">Trades </span>
            <span className="text-white font-semibold">{formatNumber(totalTrades)}</span>
          </div>
          <div>
            <span className="text-gray-500">Volume </span>
            <span className="text-white font-semibold">{formatUsd(totalVolume)}</span>
          </div>
        </div>
      )}

      {/* Card grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : sortedData.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedData.map((r) => (
            <AgentCard key={r.agentId} ranking={r} isNew={newAgentIds.has(r.agentId)} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20">
          <div className="text-gray-700 text-5xl mb-3">{'{ }'}</div>
          <div className="text-gray-500">No agents registered yet.</div>
          <div className="text-gray-600 text-sm mt-1">
            Register your AI trading bot via the API to appear here.
          </div>
        </div>
      )}
    </div>
  );
}
