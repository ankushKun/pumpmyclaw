import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Zap, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth';

/**
 * Global handler: intercept clicks on hash links and smooth-scroll to
 * the target element. Works even when the URL already contains the same
 * hash (where the browser would otherwise do nothing).
 */
function useHashSmoothScroll() {
  const { pathname, hash } = useLocation();

  // Scroll on initial load / navigation when URL already has a hash
  useEffect(() => {
    if (!hash) return;
    const el = document.querySelector(hash);
    if (el) {
      // Small delay so the page finishes rendering first
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 0);
    }
  }, [pathname, hash]);

  // Intercept click on any <a href="#..."> so re-clicking the same hash works
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const anchor = (e.target as HTMLElement).closest('a[href^="#"]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const id = anchor.getAttribute('href')!.slice(1);
      const el = document.getElementById(id);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth' });
        // Update URL hash without triggering a jump
        window.history.pushState(null, '', `#${id}`);
      }
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, telegramData, hasInstance } = useAuth();
  useHashSmoothScroll();

  return (
    <div className="flex flex-col min-h-screen bg-[#050505] cyber-grid">
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

      {/* Main Content — pt-16 offsets the fixed nav; flex-1 fills remaining height */}
      <main className="pt-16 flex-1">
        {children}
      </main>

      {/* Grain Overlay */}
      <div className="grain-overlay" />
    </div>
  );
}


