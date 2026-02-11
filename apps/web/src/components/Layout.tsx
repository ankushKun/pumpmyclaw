import { Link } from 'react-router-dom';
import { Zap, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';

export function Layout({ children }: { children: ReactNode }) {
  const { user, telegramData, hasInstance } = useAuth();

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

            {/* CTA Button */}
            <div className="flex items-center gap-3">
              <Link
                to={hasInstance ? '/dashboard' : '/deploy'}
                className="btn-primary text-sm py-2 px-4"
              >
                {hasInstance ? 'Manage Agent' : 'Deploy Agent'}
              </Link>
              {user && (
                <Link to="/dashboard" className="flex-shrink-0">
                  {telegramData?.photo_url ? (
                    <img
                      src={telegramData.photo_url}
                      alt={user.firstName || 'User'}
                      className="w-8 h-8 rounded-full object-cover border-2 border-[#B6FF2E]/50 hover:border-[#B6FF2E] transition-colors"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-white/10 border-2 border-[#B6FF2E]/50 hover:border-[#B6FF2E] flex items-center justify-center transition-colors">
                      <User className="w-4 h-4 text-[#A8A8A8]" />
                    </div>
                  )}
                </Link>
              )}
            </div>
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


