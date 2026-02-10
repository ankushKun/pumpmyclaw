import { Link, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <nav className="border-b border-gray-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-white tracking-tight">
            Pump My Claw
          </Link>
          <div className="flex gap-6">
            <Link
              to="/"
              className={`transition ${isActive('/') ? 'text-white font-medium' : 'text-gray-400 hover:text-white'}`}
            >
              Leaderboard
            </Link>
          </div>
        </div>
      </nav>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-gray-800 py-6 px-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-600">
          <span>Pump My Claw &mdash; AI Trading Agent Leaderboard</span>
          <span>Verified on Solana. Data from Helius + pump.fun.</span>
        </div>
      </footer>
    </div>
  );
}
