import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle, ExternalLink, Bot, Key, Cpu, Loader2, User, LogOut, Zap, Shield, Lock, Clock, Sparkles, Check } from 'lucide-react';
import { MODELS, CUSTOM_MODEL_ID } from '../lib/models';
import { useAuth } from '../lib/auth';
import { backend } from '../lib/api';
import botTokenVideo from '../assets/bot-token.mp4';
import openrouterKeyVideo from '../assets/openrouter-key.mp4';

const IS_DEV = import.meta.env.DEV;
const TELEGRAM_BOT_NAME = import.meta.env.VITE_TELEGRAM_BOT_NAME;

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface BotInfo {
  username: string;
  firstName: string;
}

interface OpenRouterKeyInfo {
  label: string;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset: string | null;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  is_free_tier: boolean;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUser) => void;
  }
}

function TelegramLoginWidget({ botName, onAuth }: { botName: string; onAuth: (user: TelegramUser) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [widgetLoaded, setWidgetLoaded] = useState(false);

  useEffect(() => {
    window.onTelegramAuth = onAuth;

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");

    ref.current?.appendChild(script);

    // Poll for the iframe the widget injects
    const poll = setInterval(() => {
      if (ref.current?.querySelector("iframe")) {
        setWidgetLoaded(true);
        clearInterval(poll);
      }
    }, 100);

    return () => {
      clearInterval(poll);
      if (ref.current?.contains(script)) {
        ref.current.removeChild(script);
      }
      delete window.onTelegramAuth;
    };
  }, [botName, onAuth]);

  return (
    <div className="flex justify-center min-h-[40px]">
      {!widgetLoaded && (
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[#A8A8A8]" />
          <span className="text-sm text-[#A8A8A8]">Loading Telegram...</span>
        </div>
      )}
      <div
        ref={ref}
        className={widgetLoaded ? "flex justify-center" : "hidden"}
      />
    </div>
  );
}

async function fetchKeyInfo(apiKey: string): Promise<OpenRouterKeyInfo | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.data ?? null;
  } catch {
    return null;
  }
}

async function fetchBotInfo(token: string): Promise<BotInfo | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok) {
      return {
        username: data.result.username,
        firstName: data.result.first_name,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => i + 1).map((s) => (
        <div key={s} className="flex items-center">
          <div
            className={`
              w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
              transition-all duration-300
              ${s < current
                ? 'bg-[#B6FF2E] text-black'
                : s === current
                  ? 'bg-[#B6FF2E] text-black glow-lime'
                  : 'bg-white/5 text-[#A8A8A8] border border-white/10'
              }
            `}
          >
            {s < current ? <CheckCircle className="w-4 h-4" /> : s}
          </div>
          {s < total && (
            <div
              className={`w-12 h-0.5 mx-2 transition-all duration-300 ${s < current ? 'bg-[#B6FF2E]' : 'bg-white/10'
                }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function usePreloadedVideo(src: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoke = '';
    let cancelled = false;

    fetch(src)
      .then((res) => res.blob())
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoke = url;
        setBlobUrl(url);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [src]);

  return blobUrl;
}

function VideoWithSkeleton({
  src,
  blobUrl,
  className,
}: {
  src: string;
  blobUrl: string | null;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const videoSrc = blobUrl ?? src;

  return (
    <div className={`relative ${className ?? ''}`}>
      {!ready && (
        <div className="absolute inset-0 skeleton rounded-lg" />
      )}
      <video
        key={videoSrc}
        src={videoSrc}
        autoPlay
        loop
        muted
        playsInline
        onCanPlay={() => setReady(true)}
        className={`w-full h-full object-contain rounded-lg transition-opacity duration-300 ${
          ready ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}

function InstructionStep({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 mb-2.5">
      <div className="w-5 h-5 rounded-full bg-[#B6FF2E] text-black flex items-center justify-center text-[10px] font-semibold flex-shrink-0 mt-0.5">
        {number}
      </div>
      <div className="text-xs text-[#A8A8A8] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export function DeployAgent() {
  const navigate = useNavigate();
  const { user, telegramData, loading: authLoading, hasInstance, hasSubscription, setHasSubscription, login, logout } = useAuth();
  const isLoggedIn = !!user;

  // Redirect authenticated users who already have an instance to the dashboard
  useEffect(() => {
    if (!authLoading && isLoggedIn && hasInstance) {
      navigate('/dashboard', { replace: true });
    }
  }, [authLoading, isLoggedIn, hasInstance, navigate]);

  // Preload video files as blob URLs as soon as the page mounts (step 1)
  const botTokenBlobUrl = usePreloadedVideo(botTokenVideo);
  const openrouterKeyBlobUrl = usePreloadedVideo(openrouterKeyVideo);

  // Subscription / checkout state
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const { data: slots } = useQuery({
    queryKey: ['slots'],
    queryFn: () => backend.getSlots(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const totalSlots = slots?.total ?? 10;
  const slotsTaken = slots?.taken ?? 0;
  const slotsRemaining = slots?.remaining ?? 10;
  const isSoldOut = slots?.soldOut ?? false;
  const fillPercent = (slotsTaken / totalSlots) * 100;

  const [step, setStep] = useState(1);
  const [devTelegramId, setDevTelegramId] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  // Step 2: Bot token
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [botName, setBotName] = useState("");
  // Step 3: OpenRouter key
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [keyInfo, setKeyInfo] = useState<OpenRouterKeyInfo | null>(null);
  const [keyVerified, setKeyVerified] = useState(false);
  const [verifyingKey, setVerifyingKey] = useState(false);
  // Step 4: Model
  const [model, setModel] = useState(MODELS[0].id);
  const [customModelId, setCustomModelId] = useState("");
  // Shared
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);
  const [tokenVerified, setTokenVerified] = useState(false);
  // deployed state removed - we navigate to /dashboard instead

  const handleTelegramAuth = async (tgUser: TelegramUser) => {
    setLoggingIn(true);
    setError("");
    try {
      await login(tgUser);
      try {
        const { subscription } = await backend.getSubscription();
        setHasSubscription(subscription?.status === 'active');
      } catch { /* ignore */ }
    } catch {
      setError("Authentication failed. Please try again.");
    } finally {
      setLoggingIn(false);
    }
  };

  const handleDevLogin = async () => {
    const id = parseInt(devTelegramId);
    if (isNaN(id) || id <= 0) {
      setError("Enter a valid numeric Telegram ID");
      return;
    }
    setLoggingIn(true);
    setError("");
    try {
      await login({
        id,
        first_name: "Dev",
        username: "dev_user",
        auth_date: Math.floor(Date.now() / 1000),
        hash: "dev_bypass",
      });
      try {
        const { subscription } = await backend.getSubscription();
        setHasSubscription(subscription?.status === 'active');
      } catch { /* ignore */ }
    } catch {
      setError("Authentication failed. Is the backend running?");
    } finally {
      setLoggingIn(false);
    }
  };

  const handleCheckout = async () => {
    setError("");
    setCheckoutLoading(true);
    try {
      const { checkoutUrl } = await backend.createCheckout();
      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout");
      setCheckoutLoading(false);
    }
  };

  // Auto-verify token when it looks valid
  const verifyToken = async (token: string) => {
    if (!token.includes(":") || token.length < 30) {
      setTokenVerified(false);
      setBotUsername("");
      setBotName("");
      return;
    }

    setValidating(true);
    setError("");
    const botInfo = await fetchBotInfo(token);
    setValidating(false);

    if (botInfo) {
      setBotUsername(botInfo.username);
      setBotName(botInfo.firstName);
      setTokenVerified(true);
    } else {
      setBotUsername("");
      setBotName("");
      setTokenVerified(false);
      setError("Could not verify bot token");
    }
  };

  const handleTokenChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const token = e.target.value;
    setTelegramBotToken(token);
    setTokenVerified(false);
    setError("");

    // Auto-verify if token looks complete (has colon and reasonable length)
    if (token.includes(":") && token.length >= 40) {
      verifyToken(token);
    }
  };

  // Auto-verify OpenRouter key
  const verifyApiKey = async (key: string) => {
    if (!key.startsWith("sk-or-")) {
      setKeyVerified(false);
      setKeyInfo(null);
      return;
    }

    setVerifyingKey(true);
    setError("");
    const info = await fetchKeyInfo(key);
    setVerifyingKey(false);

    if (info) {
      setKeyInfo(info);
      setKeyVerified(true);
    } else {
      setKeyInfo(null);
      setKeyVerified(false);
      setError("Could not verify API key");
    }
  };

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value;
    setOpenrouterApiKey(key);
    setKeyVerified(false);
    setKeyInfo(null);
    setError("");

    // Auto-verify if key looks complete
    if (key.startsWith("sk-or-") && key.length >= 20) {
      verifyApiKey(key);
    }
  };

  const validate = async (): Promise<boolean> => {
    setError("");

    if (step === 1) {
      if (!isLoggedIn) {
        setError("Please sign in with Telegram first");
        return false;
      }
      if (!hasSubscription) {
        setError("Please subscribe to Early Access before setting up your agent");
        return false;
      }
    }

    if (step === 2) {
      if (!tokenVerified) {
        if (!telegramBotToken.includes(":")) {
          setError("Invalid bot token format");
          return false;
        }
        setValidating(true);
        const botInfo = await fetchBotInfo(telegramBotToken);
        setValidating(false);
        if (!botInfo) {
          setError("Could not verify bot token");
          return false;
        }
        setBotUsername(botInfo.username);
        setBotName(botInfo.firstName);
        setTokenVerified(true);
      }
    }

    if (step === 3) {
      if (!openrouterApiKey.startsWith("sk-or-")) {
        setError("API key should start with sk-or-");
        return false;
      }
      if (!keyVerified) {
        setVerifyingKey(true);
        const info = await fetchKeyInfo(openrouterApiKey);
        setVerifyingKey(false);
        if (!info) {
          setError("Could not verify API key");
          return false;
        }
        setKeyInfo(info);
        setKeyVerified(true);
      }
    }

    if (step === 4 && model === CUSTOM_MODEL_ID) {
      if (!customModelId.trim()) {
        setError("Enter a model ID (e.g. google/gemini-2.5-flash)");
        return false;
      }
      if (!customModelId.includes("/")) {
        setError("Model ID should be in format: provider/model-name");
        return false;
      }
    }

    return true;
  };

  const next = async () => {
    if (!(await validate())) return;
    if (step < 4) {
      setStep(step + 1);
    } else {
      // Final step - store config and navigate to dashboard for creation
      const resolvedModel = model === CUSTOM_MODEL_ID ? `openrouter/${customModelId}` : model;
      sessionStorage.setItem("pmc_deploy_config", JSON.stringify({
        telegramBotToken,
        openrouterApiKey,
        botUsername,
        model: resolvedModel,
      }));
      navigate("/dashboard");
    }
  };

  const back = () => {
    setError("");
    setStep(step - 1);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] py-12 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Back to home */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-[#A8A8A8] hover:text-white transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Leaderboard
        </Link>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold mb-2">Deploy Your Agent</h1>
          <p className="text-[#A8A8A8]">
            Set up your AI trading agent in 4 simple steps
          </p>
        </div>

        {/* Step indicators */}
        <StepIndicator current={step} total={4} />

        {/* Card */}
        <div className="cyber-card p-6 sm:p-8">
          {/* Step 1: Sign In & Subscribe */}
          {step === 1 && (
            <div className="animate-fade-in space-y-6">
              {/* Section header */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#2ED0FF]/20 flex items-center justify-center">
                  <User className="w-5 h-5 text-[#2ED0FF]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Sign In & Subscribe</h2>
                  <p className="text-sm text-[#A8A8A8]">Authenticate with Telegram, then claim your early access slot</p>
                </div>
              </div>

              {/* ── Auth section ── */}
              {isLoggedIn ? (
                <div className="p-4 bg-[#B6FF2E]/10 border border-[#B6FF2E]/30 rounded-lg flex items-center gap-4">
                  {telegramData?.photo_url ? (
                    <img
                      src={telegramData.photo_url}
                      alt={user?.firstName || "User"}
                      className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[#B6FF2E]/20 flex items-center justify-center flex-shrink-0">
                      <User className="w-6 h-6 text-[#B6FF2E]" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle className="w-4 h-4 text-[#B6FF2E]" />
                      <span className="font-semibold text-[#B6FF2E] text-sm">Signed In</span>
                    </div>
                    <div className="text-sm font-medium text-white">
                      {user?.firstName || telegramData?.first_name || "User"}
                    </div>
                    <div className="text-xs text-[#A8A8A8]">
                      {user?.username && <span>@{user.username} · </span>}
                      <span className="mono">{user?.telegramId}</span>
                    </div>
                  </div>
                  <button
                    onClick={logout}
                    className="text-[#A8A8A8] hover:text-[#FF2E8C] transition-colors p-2"
                    title="Sign out"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : authLoading || loggingIn ? (
                <div className="flex items-center justify-center gap-2 py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-[#A8A8A8]" />
                  <span className="text-sm text-[#A8A8A8]">
                    {loggingIn ? "Signing in..." : "Restoring session..."}
                  </span>
                </div>
              ) : (
                <div className="space-y-6">
                  <p className="text-xs text-[#A8A8A8] text-center">
                    Sign in with Telegram to get started
                  </p>
                  {TELEGRAM_BOT_NAME && (
                    <div>
                      <TelegramLoginWidget botName={TELEGRAM_BOT_NAME} onAuth={handleTelegramAuth} />
                    </div>
                  )}

                  {IS_DEV && (
                    <div className="border-t border-white/10 pt-5">
                      <p className="text-xs text-[#A8A8A8] mb-3 uppercase tracking-wider font-semibold">
                        Dev Mode
                      </p>
                      <div className="flex gap-3">
                        <input
                          type="text"
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-[#A8A8A8]/50 focus:outline-none focus:border-[#B6FF2E]/50 focus:ring-1 focus:ring-[#B6FF2E]/25 transition-all mono text-sm"
                          placeholder="Telegram User ID (e.g. 123456789)"
                          value={devTelegramId}
                          onChange={(e) => setDevTelegramId(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleDevLogin()}
                        />
                        <button
                          onClick={handleDevLogin}
                          className="btn-secondary text-sm py-2 px-4"
                        >
                          Use ID
                        </button>
                      </div>
                    </div>
                  )}

                  {!TELEGRAM_BOT_NAME && !IS_DEV && (
                    <p className="text-sm text-[#FF2E8C]">
                      Telegram login not configured. Set VITE_TELEGRAM_BOT_NAME in your environment.
                    </p>
                  )}
                </div>
              )}

              {/* ── Subscription / Pricing section ── */}
              {isLoggedIn && (
                <div className="border-t border-white/10 pt-6">
                  {hasSubscription ? (
                    /* Already subscribed */
                    <div className="p-4 bg-[#B6FF2E]/10 border border-[#B6FF2E]/30 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle className="w-5 h-5 text-[#B6FF2E]" />
                        <span className="font-semibold text-[#B6FF2E]">Early Access Active</span>
                      </div>
                      <p className="text-sm text-[#A8A8A8]">
                        Your subscription is active. Click Next to set up your agent.
                      </p>
                    </div>
                  ) : (
                    /* Not subscribed - show pricing card */
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-lg bg-[#B6FF2E]/10 flex items-center justify-center">
                          <Bot className="w-5 h-5 text-[#B6FF2E]" />
                        </div>
                        <div>
                          <h3 className="text-base font-bold text-white">Early Access — $19.99/mo</h3>
                          <p className="text-xs text-[#A8A8A8]">
                            <span className="line-through">$40.00</span>
                            <span className="text-[#FF2E8C] font-semibold ml-1.5">50% OFF</span>
                          </p>
                        </div>
                      </div>

                      {/* Slot progress */}
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-[#A8A8A8]">
                            <span className="text-white font-semibold">{slotsTaken}</span> of {totalSlots} claimed
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
                          <p className="text-[10px] text-[#FF2E8C] mt-1 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            Almost gone — {slotsRemaining} slot{slotsRemaining !== 1 ? 's' : ''} remaining
                          </p>
                        )}
                      </div>

                      {/* Features summary */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {[
                          '24/7 managed AI bot',
                          'Bring your own AI model',
                          'Telegram bot interface',
                          'Live P&L tracking',
                        ].map((f) => (
                          <div key={f} className="flex items-center gap-1.5 text-[#d4d4d4]">
                            <Check className="w-3 h-3 text-[#B6FF2E] flex-shrink-0" />
                            {f}
                          </div>
                        ))}
                      </div>

                      {/* Checkout button */}
                      {isSoldOut ? (
                        <button
                          disabled
                          className="w-full py-3 px-5 rounded-full text-sm font-bold bg-white/5 text-[#A8A8A8] border border-white/10 cursor-not-allowed flex items-center justify-center gap-2"
                        >
                          <Lock className="w-4 h-4" />
                          Sold Out — Waitlist Coming Soon
                        </button>
                      ) : (
                        <button
                          onClick={handleCheckout}
                          disabled={checkoutLoading}
                          className="w-full py-3 px-5 rounded-full text-sm font-bold bg-[#B6FF2E] text-black hover:bg-[#a8f024] transition-all duration-200 hover:shadow-[0_0_30px_rgba(182,255,46,0.3)] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                        >
                          {checkoutLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Redirecting to checkout...
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4" />
                              Subscribe — $19.99/mo
                            </>
                          )}
                        </button>
                      )}

                      {/* Trust signals */}
                      <div className="flex items-center justify-center gap-4 text-[10px] text-[#A8A8A8]">
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
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Telegram Bot Token */}
          {step === 2 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-[#2ED0FF]/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-[#2ED0FF]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Telegram Bot Token</h2>
                  <p className="text-sm text-[#A8A8A8]">Your agent needs a Telegram bot to communicate</p>
                </div>
              </div>

              {/* Video tutorial */}
              <div className="grid md:grid-cols-[1.2fr_1fr] gap-5 mb-6">
                <VideoWithSkeleton
                  src={botTokenVideo}
                  blobUrl={botTokenBlobUrl}
                  className="self-center aspect-video"
                />

                {/* Instructions */}
                <div className="bg-white/5 rounded-lg p-4 flex flex-col justify-start">
                  <p className="text-[10px] font-semibold text-[#A8A8A8] mb-3 uppercase tracking-wider">
                    Steps
                  </p>
                  <InstructionStep number={1}>
                    Open{" "}
                    <a
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2ED0FF] hover:underline inline-flex items-center gap-1"
                    >
                      @BotFather <ExternalLink className="w-3 h-3" />
                    </a>
                    {" "}in Telegram
                  </InstructionStep>
                  <InstructionStep number={2}>
                    Send <code className="px-1.5 py-0.5 bg-white/10 rounded text-[#B6FF2E] text-xs">/newbot</code> and follow the prompts
                  </InstructionStep>
                  <InstructionStep number={3}>
                    Choose a name for your bot
                  </InstructionStep>
                  <InstructionStep number={4}>
                    Choose a username ending in "bot"
                  </InstructionStep>
                  <InstructionStep number={5}>
                    Copy the <span className="text-white font-medium">API token</span> it gives you
                  </InstructionStep>
                </div>
              </div>

              {/* Input area */}
              <div>
                <label className="text-sm font-medium text-[#A8A8A8] mb-2">Bot Token</label>
                <input
                  type="text"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-[#A8A8A8]/50 focus:outline-none focus:border-[#B6FF2E]/50 focus:ring-1 focus:ring-[#B6FF2E]/25 transition-all mono text-sm"
                  placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ..."
                  value={telegramBotToken}
                  onChange={handleTokenChange}
                />

                {validating && (
                  <div className="flex items-center gap-2 mt-3 text-[#A8A8A8] text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying token...
                  </div>
                )}

                {tokenVerified && botUsername && (
                  <div className="mt-4 p-4 bg-[#B6FF2E]/10 border border-[#B6FF2E]/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-[#B6FF2E]" />
                      <span className="font-semibold text-[#B6FF2E]">Bot Verified</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-[#A8A8A8]">Name:</span> <span className="text-white">{botName}</span>
                    </div>
                    <div className="text-sm">
                      <span className="text-[#A8A8A8]">Username:</span> <span className="text-white">@{botUsername}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: OpenRouter API Key */}
          {step === 3 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-[#FF2E8C]/20 flex items-center justify-center">
                  <Key className="w-5 h-5 text-[#FF2E8C]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">OpenRouter API Key</h2>
                  <p className="text-sm text-[#A8A8A8]">Powers your agent's AI capabilities</p>
                </div>
              </div>

              {/* Video tutorial */}
              <div className="grid md:grid-cols-[1.2fr_1fr] gap-5 mb-6">
                <VideoWithSkeleton
                  src={openrouterKeyVideo}
                  blobUrl={openrouterKeyBlobUrl}
                  className="self-center aspect-video"
                />

                {/* Instructions */}
                <div className="bg-white/5 rounded-lg p-4 flex flex-col justify-start">
                  <p className="text-[10px] font-semibold text-[#A8A8A8] mb-3 uppercase tracking-wider">
                    Steps
                  </p>
                  <InstructionStep number={1}>
                    Go to{" "}
                    <a
                      href="https://openrouter.ai"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2ED0FF] hover:underline inline-flex items-center gap-1"
                    >
                      openrouter.ai <ExternalLink className="w-3 h-3" />
                    </a>
                    {" "}and sign up (free)
                  </InstructionStep>
                  <InstructionStep number={2}>
                    Click your profile icon, then go to{" "}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2ED0FF] hover:underline inline-flex items-center gap-1"
                    >
                      Keys <ExternalLink className="w-3 h-3" />
                    </a>
                  </InstructionStep>
                  <InstructionStep number={3}>
                    Click "Create Key" and copy it
                  </InstructionStep>
                </div>
              </div>

              {/* Input area */}
              <div>
                <p className="text-xs text-[#A8A8A8] mb-3">
                  Free models available - you only pay for premium models.
                </p>
                <label className="text-sm font-medium text-[#A8A8A8] mb-2 block">API Key</label>
                <input
                  type="password"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-[#A8A8A8]/50 focus:outline-none focus:border-[#B6FF2E]/50 focus:ring-1 focus:ring-[#B6FF2E]/25 transition-all mono text-sm"
                  placeholder="sk-or-v1-..."
                  value={openrouterApiKey}
                  onChange={handleKeyChange}
                />

                {verifyingKey && (
                  <div className="flex items-center gap-2 mt-3 text-[#A8A8A8] text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying key...
                  </div>
                )}

                {keyVerified && keyInfo && (
                  <div className="mt-4 p-4 bg-[#B6FF2E]/10 border border-[#B6FF2E]/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-[#B6FF2E]" />
                      <span className="font-semibold text-[#B6FF2E]">Key Verified</span>
                      {keyInfo.is_free_tier && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#B6FF2E]/20 text-[#B6FF2E] font-semibold ml-1">
                          FREE TIER
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-sm">
                      <div>
                        <span className="text-[#A8A8A8]">Credits: </span>
                        <span className="text-white">
                          {keyInfo.limit_remaining !== null ? `$${keyInfo.limit_remaining.toFixed(2)}` : "Unlimited"}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#A8A8A8]">Used today: </span>
                        <span className="text-white">${keyInfo.usage_daily.toFixed(4)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4: Model Selection */}
          {step === 4 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-[#B6FF2E]/20 flex items-center justify-center">
                  <Cpu className="w-5 h-5 text-[#B6FF2E]" />
                </div>
                <div>
                  <h2 className="text-xl font-bold">Choose AI Model</h2>
                  <p className="text-sm text-[#A8A8A8]">Select the brain for your trading agent</p>
                </div>
              </div>

              {/* API Key Usage Info */}
              {keyInfo && (
                <div className="p-4 bg-white/5 rounded-lg mb-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="col-span-2 text-xs font-semibold text-[#A8A8A8] uppercase tracking-wider mb-1">
                    API Key Info
                  </div>
                  <div>
                    <span className="text-[#A8A8A8]">Credits remaining: </span>
                    <span className={keyInfo.limit_remaining !== null && keyInfo.limit_remaining <= 0 ? 'text-[#FF2E8C]' : 'text-white'}>
                      {keyInfo.limit_remaining !== null ? `$${keyInfo.limit_remaining.toFixed(2)}` : "Unlimited"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#A8A8A8]">Used today: </span>
                    <span className="text-white">${keyInfo.usage_daily.toFixed(4)}</span>
                  </div>
                </div>
              )}

              {/* Model Selection */}
              <div className="grid grid-cols-2 gap-3">
                {MODELS.map((m) => (
                  <label
                    key={m.id}
                    className={`
                      flex flex-col gap-2 p-3 rounded-lg cursor-pointer transition-all
                      ${model === m.id
                        ? 'bg-white/10 border border-[#B6FF2E]/50'
                        : 'bg-white/5 border border-transparent hover:border-white/10'
                      }
                    `}
                    onClick={() => setModel(m.id)}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={m.id}
                      checked={model === m.id}
                      onChange={() => setModel(m.id)}
                      className="sr-only"
                    />
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${model === m.id ? 'border-[#B6FF2E] bg-[#B6FF2E]' : 'border-white/30'
                        }`}>
                        {model === m.id && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                      </div>
                      <span className="font-medium text-sm">{m.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {m.free && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#34d399]/20 text-[#34d399] font-semibold">
                          FREE
                        </span>
                      )}
                      {m.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#B6FF2E]/20 text-[#B6FF2E] font-semibold">
                          {m.badge}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#A8A8A8]">{m.desc}</div>
                  </label>
                ))}

                {/* Custom model option */}
                <label
                  className={`
                    flex flex-col gap-2 p-3 rounded-lg cursor-pointer transition-all
                    ${model === CUSTOM_MODEL_ID
                      ? 'bg-white/10 border border-[#B6FF2E]/50'
                      : 'bg-white/5 border border-transparent hover:border-white/10'
                    }
                  `}
                  onClick={() => setModel(CUSTOM_MODEL_ID)}
                >
                  <input
                    type="radio"
                    name="model"
                    value={CUSTOM_MODEL_ID}
                    checked={model === CUSTOM_MODEL_ID}
                    onChange={() => setModel(CUSTOM_MODEL_ID)}
                    className="sr-only"
                  />
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${model === CUSTOM_MODEL_ID ? 'border-[#B6FF2E] bg-[#B6FF2E]' : 'border-white/30'
                      }`}>
                      {model === CUSTOM_MODEL_ID && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                    </div>
                    <span className="font-medium text-sm">Enter your own</span>
                  </div>
                  <div className="text-xs text-[#A8A8A8]">
                    Copy model ID from{" "}
                    <a
                      href="https://openrouter.ai/models"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#2ED0FF] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      openrouter.ai/models
                    </a>
                  </div>
                  {model === CUSTOM_MODEL_ID && (
                    <input
                      type="text"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-[#A8A8A8]/50 focus:outline-none focus:border-[#B6FF2E]/50 text-sm mono"
                      placeholder="e.g. google/gemini-2.5-flash"
                      value={customModelId}
                      onChange={(e) => setCustomModelId(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  )}
                </label>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-[#FF2E8C]/10 border border-[#FF2E8C]/30 rounded-lg">
              <p className="text-sm text-[#FF2E8C]">{error}</p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            {step > 1 ? (
              <button
                onClick={back}
                className="btn-secondary text-sm py-2 px-4 flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            ) : (
              <div />
            )}
            <button
              onClick={next}
              className="btn-primary text-sm py-2 px-4 flex items-center gap-2"
              disabled={validating || verifyingKey}
            >
              {(validating || verifyingKey) ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying...
                </>
              ) : step === 4 ? (
                <>
                  Deploy Agent
                  <CheckCircle className="w-4 h-4" />
                </>
              ) : (
                <>
                  Next
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
