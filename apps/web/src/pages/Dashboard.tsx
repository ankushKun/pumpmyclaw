import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Play,
  Square,
  Trash2,
  Terminal,
  Settings,
  Wallet,
  ExternalLink,
  Copy,
  Check,
  Loader2,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import {
  backend,
  type Instance,
  type InstanceStatus,
  type WalletToken,
  type WalletTransaction,
} from "../lib/api";
import { MODELS, CUSTOM_MODEL_ID, getModelName } from "../lib/models";
import { ConfirmModal, AlertModal } from "../components/Modal";

export function Dashboard() {
  const navigate = useNavigate();
  const { user, logout, setHasInstance } = useAuth();

  const [instance, setInstance] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);

  // Creation flow (when redirected from deploy)
  const [creating, setCreating] = useState(false);
  const [creationLogs, setCreationLogs] = useState<string[]>([]);
  const [creationStatus, setCreationStatus] = useState("");

  // Actions
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [settingsModel, setSettingsModel] = useState("");
  const [customSettingsModel, setCustomSettingsModel] = useState("");
  const [settingsOrKey, setSettingsOrKey] = useState("");

  // Wallet
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<{
    sol: number;
    formatted: string;
  } | null>(null);
  const [walletTokens, setWalletTokens] = useState<WalletToken[] | null>(null);
  const [walletTransactions, setWalletTransactions] = useState<
    WalletTransaction[] | null
  >(null);
  const [showWallet, setShowWallet] = useState(false);
  const [copied, setCopied] = useState(false);

  // Modals
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [stopModalOpen, setStopModalOpen] = useState(false);
  const [alertModal, setAlertModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    type: "info" | "success" | "error";
  }>({ open: false, title: "", message: "", type: "info" });

  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef(false);
  const creationCompletedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load instance on mount ────────────────────────────────────
  useEffect(() => {
    if (!user) {
      navigate("/deploy");
      return;
    }
    loadInstance();
  }, [user, navigate]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [creationLogs]);

  // Poll status when pending
  useEffect(() => {
    if (!instance || instance.status !== "pending") return;
    const poll = setInterval(async () => {
      try {
        const status = await backend.getInstanceStatus(instance.id);
        if (status.status !== "pending") {
          setInstance((prev) =>
            prev ? { ...prev, status: status.status } : null
          );
        }
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearInterval(poll);
  }, [instance?.id, instance?.status]);

  // Auto-refresh logs when panel is open
  useEffect(() => {
    if (!showLogs || !instance) return;
    const fetchLogs = async () => {
      try {
        const content = await backend.getInstanceLogs(instance.id);
        setLogs(content);
        if (!isUserScrolledUp.current && logsContainerRef.current) {
          logsContainerRef.current.scrollTop =
            logsContainerRef.current.scrollHeight;
        }
      } catch {
        /* ignore */
      }
    };
    const interval = setInterval(fetchLogs, 1000);
    return () => clearInterval(interval);
  }, [showLogs, instance?.id]);

  // Periodically refresh instance status
  useEffect(() => {
    if (!instance) return;
    const fetchStatus = async () => {
      try {
        const status = await backend.getInstanceStatus(instance.id);
        setInstance((prev) =>
          prev ? { ...prev, status: status.status } : null
        );
      } catch {
        /* ignore */
      }
    };
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [instance?.id]);

  // Fetch wallet info
  useEffect(() => {
    if (!instance) return;
    const fetchWallet = async () => {
      try {
        const wallet = await backend.getWallet(instance.id);
        setWalletAddress(wallet.address);
        if (wallet.address) {
          const balance = await backend.getWalletBalance(instance.id);
          setWalletBalance({ sol: balance.sol, formatted: balance.formatted });
          try {
            const tokens = await backend.getWalletTokens(instance.id);
            setWalletTokens(tokens.tokens);
          } catch {
            /* ok */
          }
          try {
            const txs = await backend.getWalletTransactions(instance.id, 20);
            setWalletTransactions(txs.transactions);
          } catch {
            /* ok */
          }
        }
      } catch {
        /* ignore */
      }
    };
    fetchWallet();
    const interval = setInterval(fetchWallet, 30000);
    return () => clearInterval(interval);
  }, [instance?.id]);

  const handleLogsScroll = () => {
    if (!logsContainerRef.current) return;
    const c = logsContainerRef.current;
    isUserScrolledUp.current =
      c.scrollHeight - c.scrollTop - c.clientHeight > 50;
  };

  const loadInstance = async () => {
    try {
      const list = await backend.getInstances();
      if (list.length > 0) {
        setInstance(list[0]);
        setHasInstance(true);
      }
    } catch (err) {
      console.error("Failed to load instance:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Creation (called from DeployAgent via navigate state) ─────
  useEffect(() => {
    // Check if we were redirected here with deploy config
    const stored = sessionStorage.getItem("pmc_deploy_config");
    if (stored && !instance && !creating) {
      sessionStorage.removeItem("pmc_deploy_config");
      const config = JSON.parse(stored);
      handleCreate(config);
    }
  }, [loading]);

  const handleCreate = async (config: {
    telegramBotToken: string;
    openrouterApiKey: string;
    botUsername: string;
    model: string;
  }) => {
    setCreating(true);
    setCreationLogs([]);
    setCreationStatus("Creating instance...");
    creationCompletedRef.current = false;

    try {
      const inst = await backend.createInstance({
        telegramBotToken: config.telegramBotToken,
        telegramBotUsername: config.botUsername,
        openrouterApiKey: config.openrouterApiKey,
        model: config.model,
      });

      const createdInstance: Instance = {
        ...inst,
        botUsername: inst.botUsername || config.botUsername,
        model: inst.model || config.model,
      };
      setInstance(createdInstance);
      setHasInstance(true);
      setCreationStatus("Starting container and streaming logs...");

      // Stream logs
      const ctrl = backend.streamInstanceLogs(
        inst.id,
        (line) => {
          setCreationLogs((prev) => [...prev, line]);
          if (
            line.includes("[gateway] listening on") ||
            line.includes("[telegram]")
          ) {
            if (!creationCompletedRef.current) {
              creationCompletedRef.current = true;
              setCreationStatus("Bot is online!");
              setTimeout(() => setCreating(false), 2000);
            }
          }
        },
        (error) =>
          setCreationLogs((prev) => [...prev, `Error: ${error}`]),
        () => {}
      );

      // Poll container status
      const statusPoll = setInterval(async () => {
        if (creationCompletedRef.current) {
          clearInterval(statusPoll);
          return;
        }
        try {
          const status = await backend.getInstanceStatus(inst.id);
          if (status.status === "error" || status.status === "restarting") {
            clearInterval(statusPoll);
            ctrl.abort();
            creationCompletedRef.current = true;
            const errorMsg =
              status.error ||
              (status.restartCount > 0
                ? `Container crashed (restart count: ${status.restartCount})`
                : "Container failed to start");
            setCreationStatus(`Failed: ${errorMsg}`);
            setInstance({ ...createdInstance, status: "error" });
          } else if (status.healthy) {
            clearInterval(statusPoll);
            if (!creationCompletedRef.current) {
              creationCompletedRef.current = true;
              ctrl.abort();
              setCreationStatus("Bot is online!");
              setTimeout(() => setCreating(false), 1000);
            }
          }
        } catch {
          /* ignore */
        }
      }, 3000);

      // Timeout after 60s
      timeoutRef.current = setTimeout(async () => {
        clearInterval(statusPoll);
        ctrl.abort();
        if (!creationCompletedRef.current) {
          creationCompletedRef.current = true;
          const finalStatus = await backend
            .getInstanceStatus(inst.id)
            .catch(() => null);
          if (finalStatus?.healthy) {
            setCreationStatus("Bot is online!");
          } else {
            setCreationStatus("Startup timed out. Check logs for errors.");
            setInstance({
              ...createdInstance,
              status: finalStatus?.status || "error",
            });
          }
          setCreating(false);
        }
      }, 60_000);
    } catch (err) {
      console.error("Failed to create:", err);
      setCreationStatus(
        `Failed to create instance: ${err instanceof Error ? err.message : "Unknown error"}`
      );
      setCreationLogs((prev) => [...prev, `Error: ${err}`]);
      setTimeout(() => setCreating(false), 3000);
    }
  };

  // ── Actions ───────────────────────────────────────────────────
  const handleStopConfirm = async () => {
    if (!instance) return;
    setActionLoading("stop");
    try {
      await backend.stopInstance(instance.id);
      setInstance({ ...instance, status: "stopped" });
      setStopModalOpen(false);
    } catch (err) {
      console.error("Stop failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStart = async () => {
    if (!instance) return;
    setActionLoading("start");
    try {
      await backend.startInstance(instance.id);
      setInstance({ ...instance, status: "pending" });
      let tid: ReturnType<typeof setTimeout> | null = null;
      const poll = setInterval(async () => {
        try {
          const status = await backend.getInstanceStatus(instance.id);
          if (status.status === "running" || status.status === "error") {
            clearInterval(poll);
            if (tid) clearTimeout(tid);
            setInstance((prev) =>
              prev ? { ...prev, status: status.status } : null
            );
            setActionLoading(null);
          }
        } catch {
          /* ignore */
        }
      }, 3000);
      tid = setTimeout(() => {
        clearInterval(poll);
        setActionLoading(null);
      }, 90000);
    } catch (err) {
      console.error("Start failed:", err);
      setActionLoading(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!instance) return;
    setActionLoading("delete");
    try {
      await backend.deleteInstance(instance.id);
      setInstance(null);
      setHasInstance(false);
      setShowLogs(false);
      setLogs(null);
      setDeleteModalOpen(false);
    } catch (err) {
      console.error("Delete failed:", err);
      setAlertModal({
        open: true,
        title: "Delete Failed",
        message: "Failed to delete instance. Please try again.",
        type: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleLogs = async () => {
    if (!instance) return;
    if (showLogs) {
      setShowLogs(false);
      isUserScrolledUp.current = false;
      return;
    }
    setActionLoading("logs");
    try {
      const content = await backend.getInstanceLogs(instance.id);
      setLogs(content);
      setShowLogs(true);
      setShowSettings(false);
      setShowWallet(false);
      isUserScrolledUp.current = false;
      setTimeout(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop =
            logsContainerRef.current.scrollHeight;
        }
      }, 50);
    } catch (err) {
      console.error("Logs failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  // ── Settings ──────────────────────────────────────────────────
  const toggleSettings = () => {
    if (!instance) return;
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    const currentModel = instance.model || MODELS[0].id;
    const isKnown = MODELS.some((m) => m.id === currentModel);
    setSettingsModel(isKnown ? currentModel : CUSTOM_MODEL_ID);
    setCustomSettingsModel(
      isKnown ? "" : currentModel.replace(/^openrouter\//, "")
    );
    setSettingsOrKey("");
    setShowSettings(true);
    setShowLogs(false);
    setShowWallet(false);
  };

  const saveSettings = async () => {
    if (!instance) return;
    const updates: { model?: string; openrouterApiKey?: string } = {};
    const resolvedModel =
      settingsModel === CUSTOM_MODEL_ID
        ? `openrouter/${customSettingsModel}`
        : settingsModel;
    if (resolvedModel && resolvedModel !== instance.model)
      updates.model = resolvedModel;
    if (settingsOrKey) updates.openrouterApiKey = settingsOrKey;
    if (Object.keys(updates).length === 0) {
      setShowSettings(false);
      return;
    }
    setActionLoading("settings");
    try {
      const res = await backend.updateInstance(instance.id, updates);
      setInstance({ ...instance, ...updates, status: "running" });
      setShowSettings(false);
      setAlertModal({
        open: true,
        title: "Settings Saved",
        message: res.restarted
          ? "Settings saved. Bot is restarting..."
          : "Settings saved successfully.",
        type: "success",
      });
    } catch (err) {
      console.error("Settings failed:", err);
      setAlertModal({
        open: true,
        title: "Save Failed",
        message: "Failed to save settings. Please try again.",
        type: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Status helpers ────────────────────────────────────────────
  const statusColor = (s: string) => {
    if (s === "running") return "bg-[#34d399]";
    if (s === "stopped") return "bg-[#A8A8A8]";
    if (s === "pending" || s === "restarting") return "bg-[#FBBF24]";
    return "bg-[#FF2E8C]";
  };

  const statusLabel = (s: string) => {
    if (s === "running") return "Bot Online";
    if (s === "stopped") return "Bot Stopped";
    if (s === "pending") return "Bot Starting...";
    if (s === "restarting") return "Bot Restarting...";
    return "Bot Error";
  };

  // ── Guards ────────────────────────────────────────────────────
  if (!user) return null;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#A8A8A8]" />
      </div>
    );
  }

  // ── No instance: redirect to deploy ───────────────────────────
  if (!instance && !creating) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="cyber-card p-8 max-w-md w-full text-center">
          <h2 className="text-xl font-bold mb-3">No Agent Deployed</h2>
          <p className="text-[#A8A8A8] mb-6">
            You haven't deployed an agent yet. Set one up now!
          </p>
          <Link to="/deploy" className="btn-primary inline-flex">
            Deploy Agent
          </Link>
        </div>
      </div>
    );
  }

  // ── Creating ──────────────────────────────────────────────────
  if (creating) {
    return (
      <div className="min-h-screen py-12 px-4">
        <div className="max-w-xl mx-auto">
          <div className="cyber-card p-8">
            <div className="text-center mb-6">
              <Loader2 className="w-8 h-8 animate-spin text-[#B6FF2E] mx-auto mb-4" />
              <h2 className="text-xl font-bold mb-2">Setting Up Your Bot</h2>
              <p className="text-[#A8A8A8] text-sm">{creationStatus}</p>
            </div>

            <div className="bg-black/50 rounded-lg p-4 max-h-[300px] overflow-y-auto font-mono text-xs">
              {creationLogs.length === 0 ? (
                <p className="text-[#A8A8A8] m-0">
                  Waiting for container logs...
                </p>
              ) : (
                creationLogs.map((line, i) => (
                  <div
                    key={i}
                    className={`mb-1 ${
                      line.includes("Error")
                        ? "text-[#FF2E8C]"
                        : "text-[#A8A8A8]"
                    }`}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>

            <p className="text-[#A8A8A8] text-xs text-center mt-4">
              This may take a minute while OpenClaw initializes...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen py-12 px-4">
      <div className="max-w-xl mx-auto">
        {/* Back link */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-[#A8A8A8] hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Leaderboard
        </Link>

        <div className="cyber-card p-6 sm:p-8">
          {/* Status header */}
          <div className="flex items-center justify-center gap-2.5 mb-6">
            <span
              className={`w-2.5 h-2.5 rounded-full ${statusColor(instance!.status)} ${
                instance!.status === "running" ? "animate-pulse-glow" : ""
              }`}
            />
            <span className="text-lg font-semibold">
              {statusLabel(instance!.status)}
            </span>
          </div>

          {/* Telegram link */}
          {instance!.botUsername && (
            <div className="text-center mb-6">
              <a
                href={`https://t.me/${instance!.botUsername}?start=true`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-flex text-sm py-2.5 px-5"
              >
                Open @{instance!.botUsername} in Telegram
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Model */}
          {instance!.model && (
            <p className="text-[#A8A8A8] text-sm text-center mb-6">
              Model: {getModelName(instance!.model)}
            </p>
          )}

          {/* Controls */}
          <div className="flex flex-wrap gap-2 justify-center mb-6">
            {instance!.status === "running" ? (
              <button
                onClick={() => setStopModalOpen(true)}
                className="btn-secondary text-sm py-2 px-4"
                disabled={actionLoading !== null}
              >
                <Square className="w-3.5 h-3.5" />
                {actionLoading === "stop" ? "Stopping..." : "Stop"}
              </button>
            ) : instance!.status === "stopped" ? (
              <button
                onClick={handleStart}
                className="btn-primary text-sm py-2 px-4"
                disabled={actionLoading !== null}
              >
                <Play className="w-3.5 h-3.5" />
                {actionLoading === "start" ? "Starting..." : "Start"}
              </button>
            ) : null}

            <button
              onClick={handleToggleLogs}
              className={`text-sm py-2 px-4 ${showLogs ? "btn-primary" : "btn-secondary"}`}
              disabled={actionLoading === "logs"}
            >
              <Terminal className="w-3.5 h-3.5" />
              {actionLoading === "logs"
                ? "Loading..."
                : showLogs
                  ? "Hide Logs"
                  : "Logs"}
            </button>

            <button
              onClick={toggleSettings}
              className={`text-sm py-2 px-4 ${showSettings ? "btn-primary" : "btn-secondary"}`}
              disabled={actionLoading !== null}
            >
              <Settings className="w-3.5 h-3.5" />
              {showSettings ? "Hide" : "Settings"}
            </button>

            <button
              onClick={() => {
                setShowWallet(!showWallet);
                if (!showWallet) {
                  setShowLogs(false);
                  setShowSettings(false);
                }
              }}
              className={`text-sm py-2 px-4 ${showWallet ? "btn-primary" : "btn-secondary"}`}
            >
              <Wallet className="w-3.5 h-3.5" />
              {showWallet ? "Hide" : "Wallet"}
            </button>
          </div>

          {/* ── Logs panel ──────────────────────────────────────── */}
          {showLogs && (
            <div className="mb-6 animate-fade-in">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium text-[#A8A8A8]">
                  Container Logs{" "}
                  {!isUserScrolledUp.current && (
                    <span className="text-[#34d399] text-xs">(live)</span>
                  )}
                </span>
              </div>
              <div
                ref={logsContainerRef}
                onScroll={handleLogsScroll}
                className="bg-black/50 rounded-lg p-4 max-h-[400px] overflow-y-auto"
              >
                <pre className="font-mono text-xs text-[#A8A8A8] whitespace-pre-wrap m-0">
                  {logs || "No logs available"}
                </pre>
              </div>
            </div>
          )}

          {/* ── Settings panel ──────────────────────────────────── */}
          {showSettings && (
            <div className="mb-6 bg-white/5 rounded-lg p-5 animate-fade-in">
              <h3 className="text-sm font-semibold mb-4">Bot Settings</h3>

              <div className="mb-4">
                <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                  AI Model
                </label>
                <select
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#B6FF2E]/50"
                  value={settingsModel}
                  onChange={(e) => {
                    setSettingsModel(e.target.value);
                    if (e.target.value !== CUSTOM_MODEL_ID)
                      setCustomSettingsModel("");
                  }}
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.free ? " (FREE)" : ""}
                    </option>
                  ))}
                  <option value={CUSTOM_MODEL_ID}>Enter your own</option>
                </select>
                {settingsModel === CUSTOM_MODEL_ID && (
                  <input
                    type="text"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm mt-2 mono focus:outline-none focus:border-[#B6FF2E]/50"
                    placeholder="e.g. google/gemini-2.5-flash"
                    value={customSettingsModel}
                    onChange={(e) => setCustomSettingsModel(e.target.value)}
                    autoFocus
                  />
                )}
              </div>

              <div className="mb-4">
                <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                  OpenRouter API Key{" "}
                  <span className="text-[#A8A8A8]/60">(blank = keep current)</span>
                </label>
                <input
                  type="password"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm mono focus:outline-none focus:border-[#B6FF2E]/50"
                  placeholder="sk-or-..."
                  value={settingsOrKey}
                  onChange={(e) => setSettingsOrKey(e.target.value)}
                />
              </div>

              <p className="text-[#A8A8A8] text-xs mb-4">
                Saving will restart your bot with the new settings.
              </p>

              <button
                onClick={saveSettings}
                className="btn-primary w-full text-sm py-2.5"
                disabled={actionLoading === "settings"}
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${actionLoading === "settings" ? "animate-spin" : ""}`}
                />
                {actionLoading === "settings"
                  ? "Saving..."
                  : "Save & Restart Bot"}
              </button>
            </div>
          )}

          {/* ── Wallet panel ────────────────────────────────────── */}
          {showWallet && (
            <div className="mb-6 bg-white/5 rounded-lg p-5 animate-fade-in">
              <h3 className="text-sm font-semibold mb-4">Bot Wallet</h3>

              {walletAddress ? (
                <>
                  {/* Address */}
                  <div className="mb-4">
                    <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                      Wallet Address
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-xs mono"
                        value={walletAddress}
                        readOnly
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(walletAddress);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="btn-secondary text-xs py-2 px-3"
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-[#34d399]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Balance */}
                  <div className="mb-4">
                    <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                      SOL Balance
                    </label>
                    <div
                      className={`text-2xl font-bold ${
                        walletBalance && walletBalance.sol > 0
                          ? "text-[#34d399]"
                          : "text-[#A8A8A8]"
                      }`}
                    >
                      {walletBalance ? walletBalance.formatted : "Loading..."}
                    </div>
                  </div>

                  {/* Tokens */}
                  {walletTokens && walletTokens.length > 0 && (
                    <div className="mb-4">
                      <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                        Token Holdings ({walletTokens.length})
                      </label>
                      <div className="max-h-[150px] overflow-y-auto bg-black/30 rounded-lg p-2">
                        {walletTokens.map((token) => (
                          <div
                            key={token.mint}
                            className="flex justify-between items-center py-2 px-2 border-b border-white/5 text-xs"
                          >
                            <a
                              href={`https://solscan.io/token/${token.mint}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mono text-[#2ED0FF] hover:underline"
                            >
                              {token.mint.slice(0, 4)}...{token.mint.slice(-4)}
                            </a>
                            <span className="font-medium">
                              {parseFloat(token.balance).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transactions */}
                  {walletTransactions && walletTransactions.length > 0 && (
                    <div className="mb-4">
                      <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                        Recent Transactions
                      </label>
                      <div className="max-h-[250px] overflow-y-auto bg-black/30 rounded-lg p-2">
                        {walletTransactions.map((tx) => (
                          <div
                            key={tx.signature}
                            className="py-2 px-2 border-b border-white/5 text-xs"
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  tx.type === "buy" || tx.type === "receive"
                                    ? "bg-[#34d399]/20 text-[#34d399]"
                                    : tx.type === "sell" || tx.type === "send"
                                      ? "bg-[#FF2E8C]/20 text-[#FF2E8C]"
                                      : "bg-white/10 text-[#A8A8A8]"
                                }`}
                              >
                                {tx.type}
                              </span>
                              <span className="text-[#A8A8A8] text-[10px]">
                                {tx.blockTime
                                  ? new Date(
                                      tx.blockTime * 1000
                                    ).toLocaleString()
                                  : "Pending"}
                              </span>
                            </div>
                            {tx.solChange && (
                              <div
                                className={`font-medium ${
                                  parseFloat(tx.solChange) > 0
                                    ? "text-[#34d399]"
                                    : "text-[#FF2E8C]"
                                }`}
                              >
                                {parseFloat(tx.solChange) > 0 ? "+" : ""}
                                {parseFloat(tx.solChange).toFixed(4)} SOL
                              </div>
                            )}
                            <a
                              href={`https://solscan.io/tx/${tx.signature}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-[#A8A8A8] hover:text-white"
                            >
                              {tx.signature.slice(0, 8)}...
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <a
                    href={`https://solscan.io/account/${walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-secondary w-full text-sm py-2.5 justify-center"
                  >
                    View on Solscan
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </>
              ) : (
                <p className="text-[#A8A8A8] text-center py-4 text-sm">
                  Wallet will be created when your bot starts for the first
                  time.
                </p>
              )}
            </div>
          )}

          {/* ── Delete ──────────────────────────────────────────── */}
          <div className="border-t border-white/10 pt-5 text-center">
            <button
              onClick={() => setDeleteModalOpen(true)}
              className="text-sm py-2 px-4 text-[#FF2E8C] border border-[#FF2E8C]/30 rounded-full hover:bg-[#FF2E8C]/10 transition-all inline-flex items-center gap-2"
              disabled={actionLoading !== null}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {actionLoading === "delete" ? "Deleting..." : "Delete Instance"}
            </button>
            <p className="text-[#A8A8A8] text-xs mt-2">
              This stops your bot and removes all data
            </p>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ConfirmModal
        isOpen={stopModalOpen}
        onClose={() => setStopModalOpen(false)}
        onConfirm={handleStopConfirm}
        title="Stop Bot"
        message="Are you sure you want to stop your bot? It will no longer respond to messages until you start it again."
        confirmText="Stop"
        loading={actionLoading === "stop"}
      />
      <ConfirmModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Instance"
        message="Are you sure? This will stop your bot and delete all instance data. This action cannot be undone."
        confirmText="Delete"
        danger
        loading={actionLoading === "delete"}
      />
      <AlertModal
        isOpen={alertModal.open}
        onClose={() => setAlertModal({ ...alertModal, open: false })}
        title={alertModal.title}
        message={alertModal.message}
        type={alertModal.type}
      />
    </div>
  );
}
