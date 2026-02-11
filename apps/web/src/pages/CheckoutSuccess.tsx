import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, ArrowRight, Loader2, Zap } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { backend } from '../lib/api';

export function CheckoutSuccess() {
  const { user } = useAuth();
  const [status, setStatus] = useState<'checking' | 'active' | 'pending'>('checking');

  useEffect(() => {
    if (!user) return;

    let attempts = 0;
    const maxAttempts = 20; // Poll for up to ~60s

    const poll = async () => {
      try {
        const { subscription } = await backend.getSubscription();
        if (subscription?.status === 'active') {
          setStatus('active');
          return;
        }
      } catch {
        // ignore
      }

      attempts++;
      if (attempts >= maxAttempts) {
        setStatus('pending');
        return;
      }

      setTimeout(poll, 3000);
    };

    poll();
  }, [user]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {status === 'checking' && (
          <div className="cyber-card p-10 animate-fade-in">
            <Loader2 className="w-12 h-12 text-[#B6FF2E] animate-spin mx-auto mb-5" />
            <h1 className="text-2xl font-bold text-white mb-2">
              Confirming Payment...
            </h1>
            <p className="text-[#A8A8A8] text-sm">
              Please wait while we confirm your subscription. This usually takes a few seconds.
            </p>
          </div>
        )}

        {status === 'active' && (
          <div className="cyber-card p-10 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[#B6FF2E]/10 border border-[#B6FF2E]/30 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-[#B6FF2E]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Welcome to Early Access!
            </h1>
            <p className="text-[#A8A8A8] text-sm mb-8">
              Your subscription is active. You can now deploy your AI trading agent.
            </p>
            <Link
              to="/deploy"
              className="btn-primary text-sm py-3 px-6 inline-flex items-center gap-2"
            >
              <Zap className="w-4 h-4" />
              Deploy Your Agent
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {status === 'pending' && (
          <div className="cyber-card p-10 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[#FBBF24]/10 border border-[#FBBF24]/30 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-[#FBBF24]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Payment Received
            </h1>
            <p className="text-[#A8A8A8] text-sm mb-4">
              Your payment is being processed. Subscription activation may take a few minutes.
            </p>
            <p className="text-[#A8A8A8] text-xs mb-8">
              You'll be able to deploy your agent once the subscription is confirmed.
              Check back shortly.
            </p>
            <Link
              to="/deploy"
              className="btn-secondary text-sm py-3 px-6 inline-flex items-center gap-2"
            >
              Go to Deploy
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
