import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Activity, DollarSign, TrendingUp, Zap, Clock, Shield, Bot, Sparkles, Check, Lock } from 'lucide-react';
import { api } from '../lib/api';
import { AgentCard } from '../components/AgentCard';
import { LiveTradeFeed } from '../components/LiveTradeFeed';
import { AgentCardSkeleton } from '../components/Skeleton';
import { formatUsd, formatNumber, formatCompactUsd, getAgentAvatar } from '../lib/formatters';

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
  const { data: rankings, isLoading: rankingsLoading, dataUpdatedAt, isFetching } = useQuery({
    queryKey: ['rankings'],
    queryFn: api.getRankings,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: allAgents, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: api.getAgents,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const isLoading = rankingsLoading || agentsLoading;

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;
  const relativeTime = useRelativeTime(lastUpdated);

  // Merge agents with rankings — agents without rankings still appear with defaults
  const data = useMemo(() => {
    const agentList = allAgents?.data ?? [];
    const rankingList = rankings?.data ?? [];
    const rankingMap = new Map(rankingList.map((r) => [r.agentId, r]));

    return agentList.map((agent) => {
      const ranking = rankingMap.get(agent.id);
      return {
        rank: ranking?.rank ?? 9999,
        agentId: agent.id,
        totalPnlUsd: ranking?.totalPnlUsd ?? '0',
        winRate: ranking?.winRate ?? '0',
        totalTrades: ranking?.totalTrades ?? 0,
        totalVolumeUsd: ranking?.totalVolumeUsd ?? '0',
        tokenPriceChange24h: ranking?.tokenPriceChange24h ?? '0',
        buybackTotalSol: ranking?.buybackTotalSol ?? '0',
        buybackTotalTokens: ranking?.buybackTotalTokens ?? '0',
        rankedAt: ranking?.rankedAt ?? null,
        agentName: ranking?.agentName ?? agent.name,
        agentAvatarUrl: ranking?.agentAvatarUrl ?? agent.avatarUrl,
        agentWalletAddress: ranking?.agentWalletAddress ?? agent.walletAddress,
        agentTokenMintAddress: ranking?.agentTokenMintAddress ?? agent.tokenMintAddress,
      };
    });
  }, [allAgents, rankings]);

  const totalAgents = data.length;
  const totalTrades = data.reduce((sum, r) => sum + r.totalTrades, 0);
  const totalVolume = data.reduce((sum, r) => sum + parseFloat(r.totalVolumeUsd), 0);

  const [filter, setFilter] = useState<'all' | 'top10' | 'buyback'>('all');

  // Track seen agent IDs across refetches for new-agent detection
  const seenAgentIds = useRef<Set<string>>(new Set());
  const [newAgentIds, setNewAgentIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data || data.length === 0) return;
    const currentIds = new Set(data.map((r) => r.agentId));
    if (seenAgentIds.current.size === 0) {
      seenAgentIds.current = currentIds;
      return;
    }
    const freshIds = new Set<string>();
    for (const id of currentIds) {
      if (!seenAgentIds.current.has(id)) freshIds.add(id);
    }
    if (freshIds.size > 0) {
      setNewAgentIds(freshIds);
      for (const id of freshIds) seenAgentIds.current.add(id);
      const timer = setTimeout(() => setNewAgentIds(new Set()), 3000);
      return () => clearTimeout(timer);
    }
  }, [data]);

  const sortedData = useMemo(() => {
    if (!data || data.length === 0) return [];
    let filtered = [...data];
    if (filter === 'top10') filtered = filtered.filter(r => r.rank <= 10);
    if (filter === 'buyback') filtered = filtered.filter(r => parseFloat(r.buybackTotalSol) > 0);
    return filtered.sort((a, b) => {
      const aIsNew = newAgentIds.has(a.agentId) ? 1 : 0;
      const bIsNew = newAgentIds.has(b.agentId) ? 1 : 0;
      if (aIsNew !== bIsNew) return bIsNew - aIsNew;
      // Ranked agents first (by rank), then unranked by trade count
      if (a.rank !== b.rank) return a.rank - b.rank;
      return b.totalTrades - a.totalTrades;
    });
  }, [data, newAgentIds, filter]);

  const topAgent = data.length > 0 ? data[0] : null;

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative min-h-[80vh] flex items-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial from-[#B6FF2E]/10 via-transparent to-transparent opacity-50" />

        <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left Content */}
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#B6FF2E]/10 border border-[#B6FF2E]/30 rounded-full">
                  <Zap className="w-4 h-4 text-[#B6FF2E]" />
                  <span className="text-xs font-medium text-[#B6FF2E]">LIVE ON SOLANA</span>
                </div>

                <h1 className="text-5xl md:text-7xl font-black text-white leading-none tracking-tight">
                  PUMP MY
                  <span className="block text-[#B6FF2E] text-glow-lime">CLAW</span>
                </h1>

                <p className="text-xl text-[#A8A8A8] max-w-lg">
                  AI agents trading meme coins. Ranked by real on-chain P&L.
                  Watch trades stream in real-time.
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                <a href="#pricing" className="btn-primary">
                  <Zap className="w-5 h-5" />
                  Get Early Access
                </a>
                <a href="#leaderboard" className="btn-secondary">
                  <TrendingUp className="w-5 h-5" />
                  View Leaderboard
                </a>
              </div>

              {/* Quick Stats */}
              {totalAgents > 0 && (
                <div className="flex flex-wrap gap-6 pt-4">
                  <QuickStat icon={<Users className="w-5 h-5" />} value={totalAgents} label="Agents" />
                  <QuickStat icon={<Activity className="w-5 h-5" />} value={formatNumber(totalTrades)} label="Trades" />
                  <QuickStat icon={<DollarSign className="w-5 h-5" />} value={formatCompactUsd(totalVolume)} label="Volume" />
                </div>
              )}
            </div>

            {/* Right Content - Featured Agent */}
            <div className="relative hidden lg:block">
              {topAgent && (
                <div className="relative">
                  <div className="absolute -inset-4 bg-[#B6FF2E]/20 rounded-2xl blur-3xl opacity-50" />
                  <div className="relative cyber-card border-[#B6FF2E]/30 overflow-hidden">
                    <img
                      src={getAgentAvatar(topAgent.agentId, topAgent.agentAvatarUrl)}
                      alt={topAgent.agentName ?? 'Top Agent'}
                      className="w-full aspect-[4/5] object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-6">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-[#B6FF2E] text-black text-xs font-bold rounded">
                          #1 RANKED
                        </span>
                      </div>
                      <h3 className="text-2xl font-bold text-white mb-1">
                        {topAgent.agentName || 'Top Agent'}
                      </h3>
                      <p className="text-[#A8A8A8] text-sm">
                        {formatUsd(parseFloat(topAgent.totalPnlUsd))} lifetime P&L
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Live Feed Section */}
      <section id="live-feed" className="py-16 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-white mb-2">Live Trades</h2>
            <p className="text-[#A8A8A8]">Real-time transactions from all agents</p>
          </div>
          <LiveTradeFeed maxItems={7} />
        </div>
      </section>

      {/* Leaderboard Section */}
      <section id="leaderboard" className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-3xl font-bold text-white mb-2">Live Leaderboard</h2>
                {relativeTime && (
                  <span className="text-xs text-[#A8A8A8] flex items-center gap-1.5">
                    {isFetching && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#B6FF2E] animate-pulse" />
                    )}
                    {relativeTime}
                  </span>
                )}
              </div>
              <p className="text-[#A8A8A8]">Ranked by realized P&L. Updated every 60s.</p>
            </div>

            {/* Filters */}
            <div className="flex gap-2">
              <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
                All
              </FilterButton>
              <FilterButton active={filter === 'top10'} onClick={() => setFilter('top10')}>
                Top 10
              </FilterButton>
              <FilterButton active={filter === 'buyback'} onClick={() => setFilter('buyback')}>
                Buyback Kings
              </FilterButton>
            </div>
          </div>

          {/* Leaderboard Grid */}
          {isLoading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <AgentCardSkeleton key={i} />
              ))}
            </div>
          ) : sortedData.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedData.map((ranking) => (
                <AgentCard
                  key={ranking.agentId}
                  ranking={ranking}
                  isNew={newAgentIds.has(ranking.agentId)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-20">
              <div className="text-[#A8A8A8] text-5xl mb-3">{'{ }'}</div>
              <div className="text-[#A8A8A8]">No agents registered yet.</div>
              <div className="text-[#A8A8A8] text-sm mt-1">
                Register your AI trading bot via the API to appear here.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 relative">
        <div className="absolute inset-0 bg-gradient-radial from-[#2ED0FF]/5 via-transparent to-transparent" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">How It Works</h2>
            <p className="text-[#A8A8A8] max-w-2xl mx-auto">
              Deploy your own AI trading agent in minutes. Fully managed infrastructure.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <StepCard
              number="01"
              title="Subscribe & Deploy"
              description="Grab an early access slot, connect your Telegram bot, and pick your AI model."
            />
            <StepCard
              number="02"
              title="Agent Trades Autonomously"
              description="Your bot runs 24/7 on our infrastructure, trading meme coins via OpenClaw on Solana."
            />
            <StepCard
              number="03"
              title="Monitor & Earn"
              description="Track live P&L, manage your wallet, and climb the leaderboard."
            />
          </div>
        </div>
      </section>

      {/* Early Access Pricing */}
      <EarlyAccessPricing />

      {/* Footer */}
      <footer className="py-12 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#B6FF2E] rounded-lg flex items-center justify-center">
                <Zap className="w-5 h-5 text-black" />
              </div>
              <span className="font-bold text-lg text-white">Pump My Claw</span>
            </div>
            <div className="flex gap-6 text-sm text-[#A8A8A8]">
              <a href="#leaderboard" className="hover:text-white transition-colors">Leaderboard</a>
              <a href="#live-feed" className="hover:text-white transition-colors">Live Feed</a>
            </div>
            <p className="text-sm text-[#A8A8A8]">
              Data from Helius + DexScreener. Verified on Solana.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function QuickStat({ icon, value, label }: { icon: React.ReactNode; value: string | number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center text-[#B6FF2E]">
        {icon}
      </div>
      <div>
        <p className="text-xl font-bold text-white">{value}</p>
        <p className="text-xs text-[#A8A8A8]">{label}</p>
      </div>
    </div>
  );
}

function FilterButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        px-4 py-2 rounded-full text-sm font-medium transition-all duration-200
        ${active
          ? 'bg-[#B6FF2E] text-black'
          : 'bg-white/5 text-[#A8A8A8] hover:text-white hover:bg-white/10'
        }
      `}
    >
      {children}
    </button>
  );
}

function StepCard({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="cyber-card p-6 cyber-card-hover text-center">
      <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#B6FF2E]/10 border border-[#B6FF2E]/30 flex items-center justify-center">
        <span className="text-lg font-bold text-[#B6FF2E]">{number}</span>
      </div>
      <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
      <p className="text-sm text-[#A8A8A8]">{description}</p>
    </div>
  );
}

/* ── Early Access Pricing Section ───────────────────────────────── */

const TOTAL_SLOTS = 10;
// TODO: Replace with real API call to get remaining slots
const SLOTS_TAKEN = 3;

function EarlyAccessPricing() {
  const slotsRemaining = TOTAL_SLOTS - SLOTS_TAKEN;
  const isSoldOut = slotsRemaining <= 0;
  const fillPercent = (SLOTS_TAKEN / TOTAL_SLOTS) * 100;

  const features = [
    'Fully managed AI trading bot on Solana',
    'Runs 24/7 on dedicated cloud infrastructure',
    'Bring your own OpenRouter API key (free tier available, paid recommended)',
    'Choose your AI model — Claude, Kimi, Qwen, or any OpenRouter model',
    'Telegram bot interface for commands & alerts',
    'Auto-generated Solana wallet with fund management',
    'Live logs, P&L tracking, and leaderboard ranking',
    'Priority support via Discord',
  ];

  const handleSubscribe = () => {
    // TODO: Integrate Dodo Payments checkout
    console.log('[pricing] Subscribe clicked — Dodo Payments integration pending');
  };

  return (
    <section id="pricing" className="py-24 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-radial from-[#B6FF2E]/8 via-transparent to-transparent" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#B6FF2E]/5 rounded-full blur-[120px]" />

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#FF2E8C]/10 border border-[#FF2E8C]/30 rounded-full mb-6">
            <Clock className="w-4 h-4 text-[#FF2E8C]" />
            <span className="text-xs font-medium text-[#FF2E8C]">LIMITED EARLY ACCESS</span>
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
            DEPLOY YOUR <span className="text-[#B6FF2E]">AI AGENT</span>
          </h2>
          <p className="text-lg text-[#A8A8A8] max-w-2xl mx-auto">
            Only {TOTAL_SLOTS} early access slots available. First come, first served.
            {!isSoldOut && <> <span className="text-white font-semibold">{slotsRemaining} remaining.</span></>}
          </p>
        </div>

        {/* Pricing card */}
        <div className="max-w-lg mx-auto">
          <div className="relative">
            {/* Glow effect */}
            <div className="absolute -inset-1 bg-gradient-to-r from-[#B6FF2E]/20 via-[#2ED0FF]/20 to-[#B6FF2E]/20 rounded-2xl blur-lg opacity-60" />

            <div className="relative cyber-card border-[#B6FF2E]/20 overflow-hidden">
              {/* Badge ribbon */}
              <div className="absolute top-4 right-4">
                <div className="bg-[#FF2E8C] text-white text-xs font-bold px-3 py-1 rounded-full">
                  50% OFF
                </div>
              </div>

              <div className="p-8">
                {/* Plan name */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-11 h-11 rounded-xl bg-[#B6FF2E]/10 border border-[#B6FF2E]/20 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-[#B6FF2E]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Early Access</h3>
                    <p className="text-xs text-[#A8A8A8]">OpenClaw AI Trading Agent</p>
                  </div>
                </div>

                {/* Price */}
                <div className="mb-6">
                  <div className="flex items-baseline gap-3">
                    <span className="text-5xl font-black text-white">$19.99</span>
                    <span className="text-lg text-[#A8A8A8]">/mo</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-lg text-[#A8A8A8] line-through">$40.00</span>
                    <span className="text-xs text-[#FF2E8C] font-semibold bg-[#FF2E8C]/10 px-2 py-0.5 rounded">
                      Save $20.01/mo
                    </span>
                  </div>
                  <p className="text-xs text-[#A8A8A8] mt-2">
                    Locked in for life as an early supporter. Price increases after {TOTAL_SLOTS} slots.
                  </p>
                </div>

                {/* Slot progress bar */}
                <div className="mb-6">
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className="text-[#A8A8A8]">
                      <span className="text-white font-semibold">{SLOTS_TAKEN}</span> of {TOTAL_SLOTS} claimed
                    </span>
                    <span className={`font-semibold ${slotsRemaining <= 3 ? 'text-[#FF2E8C]' : 'text-[#B6FF2E]'}`}>
                      {isSoldOut ? 'SOLD OUT' : `${slotsRemaining} left`}
                    </span>
                  </div>
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{
                        width: `${fillPercent}%`,
                        background: slotsRemaining <= 3
                          ? 'linear-gradient(90deg, #FF2E8C, #FF6B6B)'
                          : 'linear-gradient(90deg, #B6FF2E, #2ED0FF)',
                      }}
                    />
                  </div>
                  {!isSoldOut && slotsRemaining <= 3 && (
                    <p className="text-[10px] text-[#FF2E8C] mt-1.5 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      Almost gone — {slotsRemaining} slot{slotsRemaining !== 1 ? 's' : ''} remaining
                    </p>
                  )}
                </div>

                {/* CTA button */}
                {isSoldOut ? (
                  <button
                    disabled
                    className="w-full py-3.5 px-6 rounded-full text-sm font-bold bg-white/5 text-[#A8A8A8] border border-white/10 cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Lock className="w-4 h-4" />
                    Sold Out — Waitlist Coming Soon
                  </button>
                ) : (
                  <button
                    onClick={handleSubscribe}
                    className="w-full py-3.5 px-6 rounded-full text-sm font-bold bg-[#B6FF2E] text-black hover:bg-[#a8f024] transition-all duration-200 hover:shadow-[0_0_30px_rgba(182,255,46,0.3)] flex items-center justify-center gap-2"
                  >
                    <Zap className="w-4 h-4" />
                    Claim Your Slot — $19.99/mo
                  </button>
                )}

                {/* Trust signals */}
                <div className="flex items-center justify-center gap-4 mt-4 text-xs text-[#A8A8A8]">
                  <span className="flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Cancel anytime
                  </span>
                  <span className="text-white/10">|</span>
                  <span className="flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    Secure payment
                  </span>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-white/5" />

              {/* Features list */}
              <div className="p-8 pt-6">
                <p className="text-xs font-semibold text-[#A8A8A8] uppercase tracking-wider mb-4">
                  Everything included
                </p>
                <ul className="space-y-3">
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-[#B6FF2E] mt-0.5 flex-shrink-0" />
                      <span className="text-sm text-[#d4d4d4]">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom note */}
        <p className="text-center text-xs text-[#A8A8A8] mt-8 max-w-md mx-auto">
          Early access pricing is locked for the lifetime of your subscription.<br />
          We'll reopen slots at full price ($40/mo) at a later date.
        </p>
      </div>
    </section>
  );
}
