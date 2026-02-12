import { useState, useEffect, useRef, useCallback } from "react";
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
  RefreshCw,
  Bot,
  Cpu,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  CircleDot,
  Send,
  Plug,
  CreditCard,
  CalendarDays,
  Shield,
} from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { useAuth } from "../lib/auth";
import {
  backend,
  type Instance,
  type InstanceStatus,
  type WalletToken,
  type WalletTransaction,
  type SubscriptionInfo,
} from "../lib/api";
import { MODELS, CUSTOM_MODEL_ID, getModelName } from "../lib/models";
import { ConfirmModal, AlertModal } from "../components/Modal";

type Tab = "overview" | "logs" | "wallet" | "settings";

export function Dashboard() {
  const navigate = useNavigate();
  const { user, telegramData, setHasInstance } = useAuth();

  const [instance, setInstance] = useState<Instance | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  // Creation flow
  const [creating, setCreating] = useState(false);
  const [creationLogs, setCreationLogs] = useState<string[]>([]);
  const [creationStatus, setCreationStatus] = useState("");

  // Actions
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);

  // Settings
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
  const [copied, setCopied] = useState(false);

  // Subscription
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);

  // Fund wallet
  const { connection } = useConnection();
  const {
    publicKey: userWalletPubkey,
    sendTransaction,
    connected: userWalletConnected,
  } = useWallet();
  const [fundAmount, setFundAmount] = useState("");
  const [fundingInProgress, setFundingInProgress] = useState(false);
  const [fundResult, setFundResult] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [userWalletBalance, setUserWalletBalance] = useState<number | null>(
    null
  );

  // Fetch user's browser wallet SOL balance
  useEffect(() => {
    if (!userWalletPubkey || !connection) {
      setUserWalletBalance(null);
      return;
    }
    let cancelled = false;
    const fetch = async () => {
      try {
        const bal = await connection.getBalance(userWalletPubkey);
        if (!cancelled) setUserWalletBalance(bal / LAMPORTS_PER_SOL);
      } catch {
        if (!cancelled) setUserWalletBalance(null);
      }
    };
    fetch();
    const interval = setInterval(fetch, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [userWalletPubkey, connection]);

  const refreshBotWallet = useCallback(async () => {
    if (!instance) return;
    try {
      const balance = await backend.getWalletBalance(instance.id);
      setWalletBalance({ sol: balance.sol, formatted: balance.formatted });
    } catch {
      /* ignore */
    }
  }, [instance?.id]);

  const handleFundBot = async () => {
    if (!userWalletPubkey || !walletAddress || !sendTransaction) return;
    const amount = parseFloat(fundAmount);
    if (isNaN(amount) || amount <= 0) {
      setFundResult({ type: "error", message: "Enter a valid amount" });
      return;
    }
    if (userWalletBalance !== null && amount > userWalletBalance) {
      setFundResult({ type: "error", message: "Insufficient balance" });
      return;
    }

    setFundingInProgress(true);
    setFundResult(null);

    try {
      const recipientPubkey = new PublicKey(walletAddress);
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: userWalletPubkey,
          toPubkey: recipientPubkey,
          lamports: Math.round(amount * LAMPORTS_PER_SOL),
        })
      );

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = userWalletPubkey;

      const signature = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      setFundResult({
        type: "success",
        message: `Sent ${amount} SOL! Tx: ${signature.slice(0, 12)}...`,
      });
      setFundAmount("");

      // Refresh balances
      if (userWalletPubkey) {
        const bal = await connection.getBalance(userWalletPubkey);
        setUserWalletBalance(bal / LAMPORTS_PER_SOL);
      }
      await refreshBotWallet();
    } catch (err) {
      console.error("Fund transfer failed:", err);
      setFundResult({
        type: "error",
        message:
          err instanceof Error ? err.message : "Transaction failed",
      });
    } finally {
      setFundingInProgress(false);
    }
  };

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

  // Auto-refresh logs when tab is active
  useEffect(() => {
    if (activeTab !== "logs" || !instance) return;
    // Reset scroll tracking when switching to logs tab so we auto-scroll to bottom
    isUserScrolledUp.current = false;
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
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [activeTab, instance?.id]);

  // Smooth-scroll to bottom when logs tab becomes active
  const prevTabRef = useRef<Tab>("overview");
  useEffect(() => {
    if (activeTab === "logs" && prevTabRef.current !== "logs") {
      const tid = setTimeout(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTo({
            top: logsContainerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }
      }, 150);
      prevTabRef.current = activeTab;
      return () => clearTimeout(tid);
    }
    prevTabRef.current = activeTab;
  }, [activeTab]);

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

  // Fetch subscription info
  useEffect(() => {
    if (!user) return;
    const fetchSub = async () => {
      try {
        const res = await backend.getSubscription();
        setSubscription(res.subscription);
      } catch {
        /* ignore */
      }
    };
    fetchSub();
  }, [user]);

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

  // ── Creation ──────────────────────────────────────────────────
  useEffect(() => {
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
      setActiveTab("logs");
    } catch (err) {
      console.error("Stop failed:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStart = async () => {
    if (!instance) return;
    setActionLoading("start");
    setActiveTab("logs");
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

  // ── Settings ──────────────────────────────────────────────────
  const initSettings = () => {
    if (!instance) return;
    const currentModel = instance.model || MODELS[0].id;
    const isKnown = MODELS.some((m) => m.id === currentModel);
    setSettingsModel(isKnown ? currentModel : CUSTOM_MODEL_ID);
    setCustomSettingsModel(
      isKnown ? "" : currentModel.replace(/^openrouter\//, "")
    );
    setSettingsOrKey("");
  };

  useEffect(() => {
    if (activeTab === "settings") initSettings();
  }, [activeTab, instance?.id]);

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
    if (Object.keys(updates).length === 0) return;
    setActionLoading("settings");
    try {
      const res = await backend.updateInstance(instance.id, updates);
      setInstance({ ...instance, ...updates, status: "running" });
      if (res.restarted) {
        setActiveTab("logs");
      }
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

  const statusTextColor = (s: string) => {
    if (s === "running") return "text-[#34d399]";
    if (s === "stopped") return "text-[#A8A8A8]";
    if (s === "pending" || s === "restarting") return "text-[#FBBF24]";
    return "text-[#FF2E8C]";
  };

  const statusLabel = (s: string) => {
    if (s === "running") return "Online";
    if (s === "stopped") return "Stopped";
    if (s === "pending") return "Starting...";
    if (s === "restarting") return "Restarting...";
    return "Error";
  };

  // ── Guards ────────────────────────────────────────────────────
  if (!user) return null;

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#A8A8A8]" />
      </div>
    );
  }

  if (!instance && !creating) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="cyber-card p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <Bot className="w-8 h-8 text-[#A8A8A8]" />
          </div>
          <h2 className="text-xl font-bold mb-2">No Agent Deployed</h2>
          <p className="text-[#A8A8A8] text-sm mb-6">
            You haven't deployed an OpenClaw agent yet.
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
      <div className="min-h-[calc(100vh-4rem)] py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="cyber-card overflow-hidden">
            {/* Header bar */}
            <div className="px-6 py-5 border-b border-white/5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#B6FF2E]/10 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-[#B6FF2E]" />
              </div>
              <div>
                <h2 className="text-base font-bold">Setting Up Your Bot</h2>
                <p className="text-[#A8A8A8] text-xs mt-0.5">{creationStatus}</p>
              </div>
            </div>

            {/* Terminal */}
            <div className="bg-black/40 p-4 max-h-[350px] overflow-y-auto font-mono text-xs">
              {creationLogs.length === 0 ? (
                <p className="text-[#A8A8A8] m-0">
                  Waiting for container logs...
                </p>
              ) : (
                creationLogs.map((line, i) => (
                  <div
                    key={i}
                    className={`leading-5 ${
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

            <div className="px-6 py-3 border-t border-white/5">
              <p className="text-[#A8A8A8] text-xs">
                This may take a minute while OpenClaw initializes...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  //  MAIN DASHBOARD
  // ════════════════════════════════════════════════════════════════
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "Overview", icon: <Bot className="w-4 h-4" /> },
    { id: "logs", label: "Logs", icon: <Terminal className="w-4 h-4" /> },
    { id: "wallet", label: "Wallet", icon: <Wallet className="w-4 h-4" /> },
    { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-[calc(100vh-4rem)] py-8 px-4">
      <div className="max-w-4xl mx-auto">

        {/* ── Page header ─────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            {/* Avatar / Bot icon */}
            <div className="w-12 h-12 rounded-2xl bg-[#0B0B0B] border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
              {telegramData?.photo_url ? (
                <img
                  src={telegramData.photo_url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <Bot className="w-6 h-6 text-[#A8A8A8]" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight">
                {instance!.botUsername
                  ? `@${instance!.botUsername}`
                  : "Your Agent"}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`w-2 h-2 rounded-full ${statusColor(instance!.status)} ${
                    instance!.status === "running" ? "animate-pulse-glow" : ""
                  }`}
                />
                <span className={`text-sm font-medium ${statusTextColor(instance!.status)}`}>
                  {statusLabel(instance!.status)}
                </span>
                {instance!.model && (
                  <>
                    <span className="text-white/20">|</span>
                    <span className="text-xs text-[#A8A8A8] flex items-center gap-1">
                      <Cpu className="w-3 h-3" />
                      {getModelName(instance!.model)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2">
            {instance!.botUsername && (
              <a
                href={`https://t.me/${instance!.botUsername}?start=true`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary text-sm py-2 px-4"
              >
                <Send className="w-3.5 h-3.5" />
                Open in Telegram
              </a>
            )}
            {instance!.status === "running" || instance!.status === "pending" || instance!.status === "restarting" ? (
              <button
                onClick={() => setStopModalOpen(true)}
                className="btn-secondary text-sm py-2 px-4"
                disabled={actionLoading !== null}
              >
                <Square className="w-3.5 h-3.5" />
                {actionLoading === "stop" ? "Stopping..." : "Stop"}
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="btn-secondary text-sm py-2 px-4"
                disabled={actionLoading !== null}
              >
                <Play className="w-3.5 h-3.5" />
                {actionLoading === "start" ? "Starting..." : "Start"}
              </button>
            )}
          </div>
        </div>

        {/* ── Tab navigation ──────────────────────────────────────── */}
        <div className="flex gap-1 mb-6 border-b border-white/5 pb-px overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all rounded-t-lg whitespace-nowrap ${
                activeTab === tab.id
                  ? "text-[#B6FF2E] border-b-2 border-[#B6FF2E] bg-white/5"
                  : "text-[#A8A8A8] hover:text-white hover:bg-white/[0.02]"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ─────────────────────────────────────────── */}

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-fade-in">
            {/* Bot Info Card */}
            <div className="cyber-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Bot className="w-4 h-4 text-[#B6FF2E]" />
                <h3 className="text-sm font-semibold">Bot Info</h3>
              </div>
              <div className="space-y-3">
                <InfoRow label="Username" value={instance!.botUsername ? `@${instance!.botUsername}` : "N/A"} />
                <InfoRow label="Status" value={statusLabel(instance!.status)} valueClass={statusTextColor(instance!.status)} />
                <InfoRow label="Model" value={getModelName(instance!.model)} />
                <InfoRow
                  label="Created"
                  value={instance!.createdAt
                    ? new Date(typeof instance!.createdAt === 'string' ? instance!.createdAt : Number(instance!.createdAt) * 1000).toLocaleDateString()
                    : "N/A"
                  }
                />
              </div>
              {instance!.botUsername && (
                <a
                  href={`https://t.me/${instance!.botUsername}?start=true`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary w-full text-sm py-2.5 mt-5 justify-center"
                >
                  <Send className="w-3.5 h-3.5" />
                  Chat with Bot
                </a>
              )}
            </div>

            {/* Subscription Card */}
            <div className="cyber-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <CreditCard className="w-4 h-4 text-[#B6FF2E]" />
                <h3 className="text-sm font-semibold">Subscription</h3>
              </div>
              {subscription ? (
                <div className="space-y-3">
                  <InfoRow
                    label="Status"
                    value={subscription.status === "active" ? "Active" : subscription.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    valueClass={
                      subscription.status === "active"
                        ? "text-[#34d399]"
                        : subscription.status === "cancelled" || subscription.status === "expired"
                          ? "text-[#FF2E8C]"
                          : "text-[#FBBF24]"
                    }
                  />
                  {subscription.slotNumber && (
                    <InfoRow
                      label="Slot"
                      value={`#${subscription.slotNumber} of 10`}
                      valueClass="text-[#B6FF2E]"
                    />
                  )}
                  <InfoRow
                    label="Subscribed"
                    value={
                      subscription.createdAt
                        ? new Date(
                            typeof subscription.createdAt === "string"
                              ? subscription.createdAt
                              : Number(subscription.createdAt) * 1000
                          ).toLocaleDateString()
                        : "N/A"
                    }
                  />
                  {subscription.currentPeriodEnd && (
                    <InfoRow
                      label="Next Payment"
                      value={new Date(
                        typeof subscription.currentPeriodEnd === "string"
                          ? subscription.currentPeriodEnd
                          : Number(subscription.currentPeriodEnd) * 1000
                      ).toLocaleDateString()}
                    />
                  )}
                  {subscription.dodoSubscriptionId && !subscription.dodoSubscriptionId.startsWith("manual_grant") && (
                    <InfoRow label="Payment" value="Dodo Payments" />
                  )}
                  {subscription.dodoSubscriptionId?.startsWith("manual_grant") && (
                    <InfoRow label="Payment" value="Manually granted" valueClass="text-[#A8A8A8]" />
                  )}
                  {subscription.status === "active" && (
                    <div className="mt-4 flex items-center gap-2 bg-[#34d399]/5 border border-[#34d399]/10 rounded-lg px-3 py-2">
                      <Shield className="w-3.5 h-3.5 text-[#34d399] flex-shrink-0" />
                      <span className="text-xs text-[#34d399]">
                        Your subscription is active and in good standing.
                      </span>
                    </div>
                  )}
                  {(subscription.status === "on_hold" || subscription.status === "cancelled") && subscription.currentPeriodEnd && (
                    <div className="mt-4 flex items-center gap-2 bg-[#FBBF24]/5 border border-[#FBBF24]/10 rounded-lg px-3 py-2">
                      <CalendarDays className="w-3.5 h-3.5 text-[#FBBF24] flex-shrink-0" />
                      <span className="text-xs text-[#FBBF24]">
                        Access until{" "}
                        {new Date(
                          typeof subscription.currentPeriodEnd === "string"
                            ? subscription.currentPeriodEnd
                            : Number(subscription.currentPeriodEnd) * 1000
                        ).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6">
                  <CreditCard className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-[#A8A8A8] text-xs">
                    No subscription found.
                  </p>
                </div>
              )}
            </div>

            {/* Wallet Summary Card */}
            <div className="cyber-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-[#2ED0FF]" />
                  <h3 className="text-sm font-semibold">Wallet</h3>
                </div>
                {walletAddress && (
                  <button
                    onClick={() => setActiveTab("wallet")}
                    className="text-xs text-[#2ED0FF] hover:underline"
                  >
                    View all
                  </button>
                )}
              </div>
              {walletAddress ? (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-[#A8A8A8] mb-1">Address</div>
                    <div className="flex items-center gap-2">
                      <span className="mono text-xs truncate">{walletAddress}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(walletAddress);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="flex-shrink-0 text-[#A8A8A8] hover:text-white transition-colors"
                      >
                        {copied ? (
                          <Check className="w-3 h-3 text-[#34d399]" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#A8A8A8] mb-1">SOL Balance</div>
                    <div
                      className={`text-2xl font-bold ${
                        walletBalance && walletBalance.sol > 0
                          ? "text-[#34d399]"
                          : "text-[#A8A8A8]"
                      }`}
                    >
                      {walletBalance ? walletBalance.formatted : "..."}
                    </div>
                  </div>
                  {walletTokens && walletTokens.length > 0 && (
                    <div className="text-xs text-[#A8A8A8]">
                      {walletTokens.length} token{walletTokens.length !== 1 ? "s" : ""} held
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Wallet className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-[#A8A8A8] text-xs">
                    Wallet is created when your bot first starts.
                  </p>
                </div>
              )}
            </div>

            {/* Quick Stats Card */}
            <div className="cyber-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <CircleDot className="w-4 h-4 text-[#FF2E8C]" />
                <h3 className="text-sm font-semibold">Container</h3>
              </div>
              <div className="space-y-3">
                <InfoRow label="Runtime" value="Docker" />
                <InfoRow label="Memory" value="800 MB" />
                <InfoRow label="CPU" value="0.5 cores" />
                <InfoRow label="Restart Policy" value="Unless stopped" />
              </div>
              <button
                onClick={() => setActiveTab("logs")}
                className="btn-secondary w-full text-sm py-2.5 mt-5 justify-center"
              >
                <Terminal className="w-3.5 h-3.5" />
                View Logs
              </button>
            </div>

            {/* Recent Activity Card */}
            <div className="cyber-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-[#FBBF24]" />
                <h3 className="text-sm font-semibold">Recent Activity</h3>
              </div>
              {walletTransactions && walletTransactions.length > 0 ? (
                <div className="space-y-2">
                  {walletTransactions.slice(0, 4).map((tx) => (
                    <div
                      key={tx.signature}
                      className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center ${
                            tx.type === "buy" || tx.type === "receive"
                              ? "bg-[#34d399]/10"
                              : tx.type === "sell" || tx.type === "send"
                                ? "bg-[#FF2E8C]/10"
                                : "bg-white/5"
                          }`}
                        >
                          {tx.type === "buy" || tx.type === "receive" ? (
                            <ArrowDownLeft className="w-3 h-3 text-[#34d399]" />
                          ) : tx.type === "sell" || tx.type === "send" ? (
                            <ArrowUpRight className="w-3 h-3 text-[#FF2E8C]" />
                          ) : (
                            <RefreshCw className="w-3 h-3 text-[#A8A8A8]" />
                          )}
                        </div>
                        <div>
                          <span className="text-xs font-medium capitalize">{tx.type}</span>
                          {tx.solChange && (
                            <span
                              className={`text-xs ml-2 ${
                                parseFloat(tx.solChange) > 0
                                  ? "text-[#34d399]"
                                  : "text-[#FF2E8C]"
                              }`}
                            >
                              {parseFloat(tx.solChange) > 0 ? "+" : ""}
                              {parseFloat(tx.solChange).toFixed(4)} SOL
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-[#A8A8A8]">
                        {tx.blockTime
                          ? new Date(tx.blockTime * 1000).toLocaleDateString()
                          : ""}
                      </span>
                    </div>
                  ))}
                  <button
                    onClick={() => setActiveTab("wallet")}
                    className="text-xs text-[#2ED0FF] hover:underline mt-1"
                  >
                    View all transactions
                  </button>
                </div>
              ) : (
                <div className="text-center py-6">
                  <Clock className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-[#A8A8A8] text-xs">
                    No activity yet. Transactions will appear here.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* LOGS TAB */}
        {activeTab === "logs" && (
          <div className="animate-fade-in">
            <div className="cyber-card overflow-hidden">
              {/* Logs header */}
              <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#B6FF2E]" />
                  <span className="text-sm font-medium">Container Logs</span>
                  {!isUserScrolledUp.current && (
                    <span className="text-[10px] text-[#34d399] bg-[#34d399]/10 px-1.5 py-0.5 rounded">
                      LIVE
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-[#A8A8A8] mono">
                  Auto-refresh 2s
                </span>
              </div>

              {/* Terminal */}
              <div
                ref={logsContainerRef}
                onScroll={handleLogsScroll}
                className="bg-black/40 p-4 h-[500px] overflow-y-auto"
              >
                <pre className="font-mono text-xs text-[#A8A8A8] whitespace-pre-wrap m-0 leading-5">
                  {logs || "No logs available. Make sure your bot is running."}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* WALLET TAB */}
        {activeTab === "wallet" && (
          <div className="animate-fade-in">
            {walletAddress ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Balance card - full width top */}
                <div className="cyber-card p-5 md:col-span-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <div className="text-xs text-[#A8A8A8] mb-1">Wallet Address</div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="mono text-sm">{walletAddress}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(walletAddress);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }}
                          className="text-[#A8A8A8] hover:text-white transition-colors"
                        >
                          {copied ? (
                            <Check className="w-3.5 h-3.5 text-[#34d399]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="text-xs text-[#A8A8A8] mb-1">SOL Balance</div>
                      <div
                        className={`text-3xl font-bold ${
                          walletBalance && walletBalance.sol > 0
                            ? "text-[#34d399]"
                            : "text-[#A8A8A8]"
                        }`}
                      >
                        {walletBalance ? walletBalance.formatted : "Loading..."}
                      </div>
                    </div>
                    <a
                      href={`https://solscan.io/account/${walletAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary text-sm py-2.5 px-4 self-start"
                    >
                      View on Solscan
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {/* Fund Bot Wallet */}
                <div className="cyber-card p-5 md:col-span-3">
                  <div className="flex items-center gap-2 mb-4">
                    <Plug className="w-4 h-4 text-[#B6FF2E]" />
                    <h3 className="text-sm font-semibold">Fund Bot Wallet</h3>
                  </div>

                  {!userWalletConnected ? (
                    <div className="flex flex-col sm:flex-row items-center gap-4 py-3">
                      <p className="text-sm text-[#A8A8A8]">
                        Connect your wallet to send SOL to your bot
                      </p>
                      <WalletMultiButton
                        style={{
                          background: "rgba(182, 255, 46, 0.1)",
                          border: "1px solid rgba(182, 255, 46, 0.3)",
                          borderRadius: "9999px",
                          fontSize: "14px",
                          height: "40px",
                          lineHeight: "40px",
                          padding: "0 20px",
                          color: "#B6FF2E",
                        }}
                      />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Connected wallet info */}
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-white/5">
                        <div>
                          <div className="text-xs text-[#A8A8A8] mb-1">
                            Your Wallet
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="mono text-xs">
                              {userWalletPubkey?.toBase58().slice(0, 8)}...
                              {userWalletPubkey?.toBase58().slice(-6)}
                            </span>
                            <span className="text-xs text-[#34d399] font-medium">
                              {userWalletBalance !== null
                                ? `${userWalletBalance.toFixed(4)} SOL`
                                : "..."}
                            </span>
                          </div>
                        </div>
                        <WalletMultiButton
                          style={{
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "9999px",
                            fontSize: "12px",
                            height: "32px",
                            lineHeight: "32px",
                            padding: "0 14px",
                            color: "#A8A8A8",
                          }}
                        />
                      </div>

                      {/* Transfer form */}
                      <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                            Amount (SOL)
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              placeholder="0.00"
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm mono focus:outline-none focus:border-[#B6FF2E]/50 transition-colors pr-16"
                              value={fundAmount}
                              onChange={(e) => {
                                setFundAmount(e.target.value);
                                setFundResult(null);
                              }}
                              disabled={fundingInProgress}
                            />
                            {userWalletBalance !== null && (
                              <button
                                onClick={() => {
                                  // Leave ~0.005 SOL for fee
                                  const max = Math.max(
                                    0,
                                    userWalletBalance - 0.005
                                  );
                                  setFundAmount(max.toFixed(4));
                                  setFundResult(null);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#B6FF2E] hover:text-[#B6FF2E]/80 transition-colors uppercase font-semibold"
                              >
                                Max
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-end">
                          <button
                            onClick={handleFundBot}
                            disabled={
                              fundingInProgress ||
                              !fundAmount ||
                              parseFloat(fundAmount) <= 0
                            }
                            className="btn-primary text-sm py-2.5 px-6 whitespace-nowrap"
                          >
                            {fundingInProgress ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Sending...
                              </>
                            ) : (
                              <>
                                <Send className="w-3.5 h-3.5" />
                                Send SOL to Bot
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Result feedback */}
                      {fundResult && (
                        <div
                          className={`rounded-lg px-3 py-2 text-xs ${
                            fundResult.type === "success"
                              ? "bg-[#34d399]/10 border border-[#34d399]/20 text-[#34d399]"
                              : "bg-[#FF2E8C]/10 border border-[#FF2E8C]/20 text-[#FF2E8C]"
                          }`}
                        >
                          {fundResult.message}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tokens */}
                <div className="cyber-card p-5 md:col-span-1">
                  <h3 className="text-sm font-semibold mb-3">
                    Token Holdings
                    {walletTokens && (
                      <span className="text-[#A8A8A8] font-normal ml-1">
                        ({walletTokens.length})
                      </span>
                    )}
                  </h3>
                  {walletTokens && walletTokens.length > 0 ? (
                    <div className="space-y-1 max-h-[300px] overflow-y-auto">
                      {walletTokens.map((token) => (
                        <div
                          key={token.mint}
                          className="flex justify-between items-center py-2 px-2 rounded-lg hover:bg-white/[0.02] transition-colors"
                        >
                          <a
                            href={`https://solscan.io/token/${token.mint}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mono text-xs text-[#2ED0FF] hover:underline"
                          >
                            {token.mint.slice(0, 6)}...{token.mint.slice(-4)}
                          </a>
                          <span className="text-xs font-medium">
                            {parseFloat(token.balance).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[#A8A8A8] text-xs py-4 text-center">
                      No tokens held
                    </p>
                  )}
                </div>

                {/* Transactions */}
                <div className="cyber-card p-5 md:col-span-2">
                  <h3 className="text-sm font-semibold mb-3">
                    Transaction History
                    {walletTransactions && (
                      <span className="text-[#A8A8A8] font-normal ml-1">
                        ({walletTransactions.length})
                      </span>
                    )}
                  </h3>
                  {walletTransactions && walletTransactions.length > 0 ? (
                    <div className="space-y-1 max-h-[300px] overflow-y-auto">
                      {walletTransactions.map((tx) => (
                        <div
                          key={tx.signature}
                          className="flex items-center justify-between py-2.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                                tx.type === "buy" || tx.type === "receive"
                                  ? "bg-[#34d399]/10"
                                  : tx.type === "sell" || tx.type === "send"
                                    ? "bg-[#FF2E8C]/10"
                                    : "bg-white/5"
                              }`}
                            >
                              {tx.type === "buy" || tx.type === "receive" ? (
                                <ArrowDownLeft className="w-3.5 h-3.5 text-[#34d399]" />
                              ) : tx.type === "sell" || tx.type === "send" ? (
                                <ArrowUpRight className="w-3.5 h-3.5 text-[#FF2E8C]" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5 text-[#A8A8A8]" />
                              )}
                            </div>
                            <div>
                              <div className="text-xs font-medium capitalize">
                                {tx.type}
                              </div>
                              <a
                                href={`https://solscan.io/tx/${tx.signature}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-[#A8A8A8] hover:text-[#2ED0FF] mono"
                              >
                                {tx.signature.slice(0, 12)}...
                              </a>
                            </div>
                          </div>
                          <div className="text-right">
                            {tx.solChange && (
                              <div
                                className={`text-xs font-medium ${
                                  parseFloat(tx.solChange) > 0
                                    ? "text-[#34d399]"
                                    : "text-[#FF2E8C]"
                                }`}
                              >
                                {parseFloat(tx.solChange) > 0 ? "+" : ""}
                                {parseFloat(tx.solChange).toFixed(4)} SOL
                              </div>
                            )}
                            <div className="text-[10px] text-[#A8A8A8]">
                              {tx.blockTime
                                ? new Date(
                                    tx.blockTime * 1000
                                  ).toLocaleString()
                                : "Pending"}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[#A8A8A8] text-xs py-4 text-center">
                      No transactions yet
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="cyber-card p-10 text-center">
                <Wallet className="w-12 h-12 text-white/10 mx-auto mb-3" />
                <h3 className="text-base font-semibold mb-1">Wallet Not Created</h3>
                <p className="text-[#A8A8A8] text-sm">
                  Your bot's wallet will be automatically created when it starts
                  for the first time.
                </p>
              </div>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && (
          <div className="animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Model & API Key */}
              <div className="cyber-card p-5">
                <div className="flex items-center gap-2 mb-5">
                  <Cpu className="w-4 h-4 text-[#B6FF2E]" />
                  <h3 className="text-sm font-semibold">AI Model</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                      Model
                    </label>
                    <select
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#B6FF2E]/50 transition-colors"
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
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm mt-2 mono focus:outline-none focus:border-[#B6FF2E]/50 transition-colors"
                        placeholder="e.g. google/gemini-2.5-flash"
                        value={customSettingsModel}
                        onChange={(e) => setCustomSettingsModel(e.target.value)}
                        autoFocus
                      />
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                      OpenRouter API Key
                      <span className="text-white/30 ml-1">(leave blank to keep current)</span>
                    </label>
                    <input
                      type="password"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm mono focus:outline-none focus:border-[#B6FF2E]/50 transition-colors"
                      placeholder="sk-or-..."
                      value={settingsOrKey}
                      onChange={(e) => setSettingsOrKey(e.target.value)}
                    />
                  </div>
                  <div className="bg-[#FBBF24]/5 border border-[#FBBF24]/10 rounded-lg px-3 py-2">
                    <p className="text-xs text-[#FBBF24]/80">
                      Saving will stop and restart your bot with the new configuration.
                    </p>
                  </div>
                  <button
                    onClick={saveSettings}
                    className="btn-primary w-full text-sm py-2.5 justify-center"
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
              </div>

              {/* Danger Zone */}
              <div className="cyber-card p-5 border-[#FF2E8C]/10">
                <div className="flex items-center gap-2 mb-5">
                  <Trash2 className="w-4 h-4 text-[#FF2E8C]" />
                  <h3 className="text-sm font-semibold">Danger Zone</h3>
                </div>
                <div className="bg-[#FF2E8C]/5 border border-[#FF2E8C]/10 rounded-lg p-4 mb-4">
                  <h4 className="text-sm font-medium mb-1">Delete Instance</h4>
                  <p className="text-xs text-[#A8A8A8] mb-3">
                    Permanently stop your bot and delete all instance data. Your
                    wallet data is preserved on the server but the container and
                    configuration will be removed. This cannot be undone.
                  </p>
                  <button
                    onClick={() => setDeleteModalOpen(true)}
                    className="text-sm py-2 px-4 text-[#FF2E8C] border border-[#FF2E8C]/30 rounded-full hover:bg-[#FF2E8C]/10 transition-all inline-flex items-center gap-2"
                    disabled={actionLoading !== null}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {actionLoading === "delete"
                      ? "Deleting..."
                      : "Delete Instance"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
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

/* ── Helper: Info row for overview cards ─────────────────────────── */
function InfoRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[#A8A8A8]">{label}</span>
      <span className={`text-xs font-medium ${valueClass || "text-white"}`}>
        {value}
      </span>
    </div>
  );
}
