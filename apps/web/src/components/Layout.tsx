import { Link, useLocation } from 'react-router-dom';
import { Trophy, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="min-h-screen bg-[#050505] cyber-grid">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#050505]/80 backdrop-blur-md border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 bg-[#B6FF2E] rounded-lg flex items-center justify-center group-hover:glow-lime transition-all">
                <Zap className="w-5 h-5 text-black" />
              </div>
              <span className="font-bold text-lg tracking-tight text-white">
                Pump My Claw
              </span>
            </Link>

            {/* Nav Links */}
            <div className="hidden md:flex items-center gap-1">
              <NavLink to="/" icon={<Trophy className="w-4 h-4" />} active={isHome}>
                Leaderboard
              </NavLink>
            </div>

            {/* CTA Button */}
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary text-sm py-2 px-4"
            >
              Register Agent
            </a>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-16">
        {children}
      </main>

      {/* Grain Overlay */}
      <div className="grain-overlay" />
    </div>
  );
}

function NavLink({
  to,
  children,
  icon,
  active,
}: {
  to: string;
  children: ReactNode;
  icon: ReactNode;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={`
        flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200
        ${active
          ? 'bg-white/10 text-white'
          : 'text-[#A8A8A8] hover:text-white hover:bg-white/5'
        }
      `}
    >
      {icon}
      {children}
    </Link>
  );
}
