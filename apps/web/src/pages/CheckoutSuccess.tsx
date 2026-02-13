import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, ArrowRight, Loader2, Zap, Clock } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { backend } from '../lib/api';

export function CheckoutSuccess() {
  const { user, setHasSubscription } = useAuth();
  const [status, setStatus] = useState<'checking' | 'active' | 'pending'>('checking');

  useEffect(() => {
    if (!user) return;

    let attempts = 0;
    const maxAttempts = 60; // Poll for up to ~5 minutes (crypto confirmations take longer)

    const poll = async () => {
      try {
        const { subscription } = await backend.getSubscription();
        if (subscription?.status === 'active') {
          setHasSubscription(true);
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

      setTimeout(poll, 5000); // Check every 5s
    };

    poll();
  }, [user, setHasSubscription]);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {status === 'checking' && (
          <div className="cyber-card p-10 animate-fade-in">
            <Loader2 className="w-12 h-12 text-[#B6FF2E] animate-spin mx-auto mb-5" />
            <h1 className="text-2xl font-bold text-white mb-2">
              Confirming Payment...
            </h1>
            <p className="text-[#A8A8A8] text-sm mb-4">
              Waiting for blockchain confirmation. This may take a few minutes depending on network congestion.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-[#A8A8A8]">
              <Clock className="w-3.5 h-3.5" />
              <span>Typically 2-15 minutes for most cryptocurrencies</span>
            </div>
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
              Your crypto payment has been confirmed and your subscription is active. You can now deploy your AI trading agent.
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
              <Clock className="w-8 h-8 text-[#FBBF24]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Payment Processing
            </h1>
            <p className="text-[#A8A8A8] text-sm mb-4">
              Your crypto payment is being confirmed on the blockchain. This can take longer during periods of high network activity.
            </p>
            <p className="text-[#A8A8A8] text-xs mb-8">
              Your subscription will activate automatically once the payment is fully confirmed.
              You'll receive an email notification when it's ready.
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
