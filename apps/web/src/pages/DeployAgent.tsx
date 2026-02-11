import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle, ExternalLink, Bot, Key, Cpu, Loader2 } from 'lucide-react';
import { MODELS, CUSTOM_MODEL_ID } from '../lib/models';
import botTokenVideo from '../assets/bot-token.mp4';
import openrouterKeyVideo from '../assets/openrouter-key.mp4';

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
  const [step, setStep] = useState(1);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [botName, setBotName] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [customModelId, setCustomModelId] = useState("");
  const [error, setError] = useState("");
  const [validating, setValidating] = useState(false);
  const [tokenVerified, setTokenVerified] = useState(false);
  const [keyInfo, setKeyInfo] = useState<OpenRouterKeyInfo | null>(null);
  const [keyVerified, setKeyVerified] = useState(false);
  const [verifyingKey, setVerifyingKey] = useState(false);
  const [deployed, setDeployed] = useState(false);

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
      if (!tokenVerified) {
        if (!telegramBotToken.includes(":")) {
          setError("Invalid bot token format");
          return false;
        }
        // Try to verify if not already verified
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

    if (step === 2) {
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

    if (step === 3 && model === CUSTOM_MODEL_ID) {
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
    if (step < 3) {
      setStep(step + 1);
    } else {
      // Final step - deploy
      const resolvedModel = model === CUSTOM_MODEL_ID ? `openrouter/${customModelId}` : model;
      console.log("Deploying agent with config:", {
        telegramBotToken,
        openrouterApiKey,
        botUsername,
        model: resolvedModel,
      });
      setDeployed(true);
    }
  };

  const back = () => {
    setError("");
    setStep(step - 1);
  };

  if (deployed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="cyber-card p-8 max-w-lg w-full text-center">
          <div className="w-16 h-16 bg-[#B6FF2E] rounded-full flex items-center justify-center mx-auto mb-6 glow-lime">
            <CheckCircle className="w-8 h-8 text-black" />
          </div>
          <h2 className="text-2xl font-bold mb-3">Agent Ready!</h2>
          <p className="text-[#A8A8A8] mb-6">
            Your trading agent <span className="text-white font-medium">@{botUsername}</span> has been configured successfully.
          </p>
          <div className="bg-white/5 rounded-lg p-4 mb-6 text-left">
            <div className="text-sm text-[#A8A8A8] mb-1">Bot Name</div>
            <div className="font-medium">{botName}</div>
            <div className="text-sm text-[#A8A8A8] mt-3 mb-1">Model</div>
            <div className="font-medium mono text-sm">
              {model === CUSTOM_MODEL_ID ? customModelId : MODELS.find(m => m.id === model)?.name}
            </div>
          </div>
          <Link to="/" className="btn-primary inline-flex">
            Go to Leaderboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 px-4">
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
            Set up your AI trading agent in 3 simple steps
          </p>
        </div>

        {/* Step indicators */}
        <StepIndicator current={step} total={3} />

        {/* Card */}
        <div className="cyber-card p-6 sm:p-8">
          {/* Step 1: Telegram Bot Token */}
          {step === 1 && (
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
                <video
                  src={botTokenVideo}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain rounded-lg self-center"
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

          {/* Step 2: OpenRouter API Key */}
          {step === 2 && (
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
                <video
                  src={openrouterKeyVideo}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="w-full h-full object-contain rounded-lg self-center"
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

          {/* Step 3: Model Selection */}
          {step === 3 && (
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
              ) : step === 3 ? (
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
