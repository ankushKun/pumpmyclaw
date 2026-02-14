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
  CreditCard,
  CalendarDays,
  Shield,
  Zap,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  BarChart3,
} from "lucide-react";

import { useAuth } from "../lib/auth";
import {
  backend,
  type Instance,
  type InstanceStatus,
  type WalletToken,
  type WalletTransaction,
  type WalletStats,
  type MonadToken,
  type MonadTransaction,
  type MonadStats,
  type SubscriptionInfo,
} from "../lib/api";
import { MODELS, CUSTOM_MODEL_ID, getModelName } from "../lib/models";
import { ConfirmModal, AlertModal } from "../components/Modal";
import { generatePKCE, getAuthorizeUrl, extractCodeFromUrl, type PKCEParams } from "../lib/openai-pkce";

type Tab = "overview" | "logs" | "wallet" | "settings";
type WalletChain = "solana" | "monad";

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

  // Wallet (Solana)
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<{
    sol: number;
    formatted: string;
    solPriceUsd: number | null;
    usd: number | null;
  } | null>(null);
  const [walletTokens, setWalletTokens] = useState<WalletToken[] | null>(null);
  const [walletTransactions, setWalletTransactions] = useState<
    WalletTransaction[] | null
  >(null);
  const [walletStats, setWalletStats] = useState<WalletStats | null>(null);
  const [walletDataLoading, setWalletDataLoading] = useState(true);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const [tokensRefreshing, setTokensRefreshing] = useState(false);
  const [txRefreshing, setTxRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Wallet (Monad)
  const [monadAddress, setMonadAddress] = useState<string | null>(null);
  const [monadTestnet, setMonadTestnet] = useState(false);
  const [monadBalance, setMonadBalance] = useState<{
    mon: number;
    formatted: string;
    monPriceUsd: number | null;
    usd: number | null;
  } | null>(null);
  const [monadCopied, setMonadCopied] = useState(false);
  const [monadTokens, setMonadTokens] = useState<MonadToken[] | null>(null);
  const [monadTransactions, setMonadTransactions] = useState<MonadTransaction[] | null>(null);
  const [monadStats, setMonadStats] = useState<MonadStats | null>(null);
  const [monadTokensRefreshing, setMonadTokensRefreshing] = useState(false);
  const [monadTxRefreshing, setMonadTxRefreshing] = useState(false);

  // Wallet sub-tab for chain switching
  const [walletChain, setWalletChain] = useState<WalletChain>("solana");

  // Monad explorer base URL (testnet vs mainnet)
  const monadExplorerBase = monadTestnet
    ? "https://testnet.monadvision.com"
    : "https://monadvision.com";

  // Subscription
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);

  // OpenAI Codex auth (settings tab) — PKCE flow
  const [openaiStatus, setOpenaiStatus] = useState<{
    connected: boolean;
    provider: string | null;
    accountId: string | null;
    expired: boolean;
  } | null>(null);
  const [openaiLoading, setOpenaiLoading] = useState(false);
  const [openaiWaitingForCode, setOpenaiWaitingForCode] = useState(false);
  const [openaiCallbackUrl, setOpenaiCallbackUrl] = useState("");
  const [showOpenaiWarning, setShowOpenaiWarning] = useState(false);
  const pkceRef = useRef<PKCEParams | null>(null);

  // Anthropic (Claude) auth (settings tab) — setup-token flow
  const [anthropicStatus, setAnthropicStatus] = useState<{
    connected: boolean;
    provider: string | null;
  } | null>(null);
  const [anthropicLoading, setAnthropicLoading] = useState(false);
  const [anthropicSetupToken, setAnthropicSetupToken] = useState("");
  const [showAnthropicInput, setShowAnthropicInput] = useState(false);

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

  // Fetch wallet addresses — polls every 5s until both are found
  useEffect(() => {
    if (!instance) return;
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const fetchAddress = async () => {
      try {
        const wallet = await backend.getWallet(instance.id);
        if (cancelled) return;
        const solAddr = wallet.address ?? null;
        const monAddr = wallet.monad?.address ?? null;
        setWalletAddress(solAddr);
        setMonadAddress(monAddr);
        setMonadTestnet(wallet.monad?.testnet ?? false);
        setWalletDataLoading(false);
        // Stop polling once both wallets are found
        if (solAddr && monAddr && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      } catch {
        /* ignore — keep polling */
      }
    };
    setWalletDataLoading(true);
    fetchAddress();
    intervalId = setInterval(fetchAddress, 5000);
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [instance?.id]);

  // Fetch balance - fast refresh (3s) since it's critical and cheap
  useEffect(() => {
    if (!instance || (!walletAddress && !monadAddress)) return;
    let cancelled = false;
    let fetchInFlight = false;
    const fetchBalance = async () => {
      if (fetchInFlight) return;
      fetchInFlight = true;
      setBalanceRefreshing(true);
      try {
        const balance = await backend.getWalletBalance(instance.id);
        if (!cancelled) {
          setWalletBalance({
            sol: balance.sol,
            formatted: balance.formatted,
            solPriceUsd: balance.solPriceUsd,
            usd: balance.usd,
          });
          // Extract Monad balance from the response
          if (balance.monad && 'mon' in balance.monad) {
            setMonadBalance({
              mon: balance.monad.mon,
              formatted: balance.monad.formatted,
              monPriceUsd: balance.monad.monPriceUsd ?? null,
              usd: balance.monad.usd ?? null,
            });
          }
        }
      } catch {
        /* keep previous value */
      } finally {
        fetchInFlight = false;
        if (!cancelled) setBalanceRefreshing(false);
      }
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [instance?.id, walletAddress, monadAddress]);

  // Fetch tokens - medium refresh (8s) since RPC is slower
  useEffect(() => {
    if (!instance || !walletAddress) return;
    let cancelled = false;
    let fetchInFlight = false;
    let generation = 0;
    const fetchTokens = async () => {
      if (fetchInFlight) return;
      fetchInFlight = true;
      const thisGen = ++generation;
      setTokensRefreshing(true);
      try {
        const res = await backend.getWalletTokens(instance.id);
        if (cancelled || thisGen !== generation) return;
        // Don't replace non-empty with empty (flaky RPC)
        setWalletTokens((prev) =>
          res.tokens.length === 0 && prev && prev.length > 0 ? prev : res.tokens
        );
      } catch {
        /* keep previous value */
      } finally {
        fetchInFlight = false;
        if (!cancelled) setTokensRefreshing(false);
      }
    };
    fetchTokens();
    const interval = setInterval(fetchTokens, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [instance?.id, walletAddress]);

  // Fetch transactions & stats - slower refresh (10s) since these are less time-critical
  useEffect(() => {
    if (!instance || !walletAddress) return;
    let cancelled = false;
    let fetchInFlight = false;
    let generation = 0;
    const fetchTxAndStats = async () => {
      if (fetchInFlight) return;
      fetchInFlight = true;
      const thisGen = ++generation;
      setTxRefreshing(true);
      try {
        const [txRes, statsRes] = await Promise.allSettled([
          backend.getWalletTransactions(instance.id, 20),
          backend.getWalletStats(instance.id),
        ]);
        if (cancelled || thisGen !== generation) return;
        if (txRes.status === "fulfilled") {
          const newTxs = txRes.value.transactions;
          setWalletTransactions((prev) =>
            newTxs.length === 0 && prev && prev.length > 0 ? prev : newTxs
          );
        }
        if (statsRes.status === "fulfilled") {
          setWalletStats(statsRes.value);
        }
      } catch {
        /* keep previous values */
      } finally {
        fetchInFlight = false;
        if (!cancelled) setTxRefreshing(false);
      }
    };
    fetchTxAndStats();
    const interval = setInterval(fetchTxAndStats, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [instance?.id, walletAddress]);

  // Fetch Monad tokens - medium refresh (10s)
  useEffect(() => {
    if (!instance || !monadAddress) return;
    let cancelled = false;
    let fetchInFlight = false;
    const fetchMonadTokens = async () => {
      if (fetchInFlight) return;
      fetchInFlight = true;
      setMonadTokensRefreshing(true);
      try {
        const res = await backend.getMonadTokens(instance.id);
        if (!cancelled) {
          setMonadTokens((prev) =>
            res.tokens.length === 0 && prev && prev.length > 0 ? prev : res.tokens
          );
        }
      } catch { /* keep previous */ }
      finally {
        fetchInFlight = false;
        if (!cancelled) setMonadTokensRefreshing(false);
      }
    };
    fetchMonadTokens();
    const interval = setInterval(fetchMonadTokens, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [instance?.id, monadAddress]);

  // Fetch Monad transactions & stats - slower refresh (12s)
  useEffect(() => {
    if (!instance || !monadAddress) return;
    let cancelled = false;
    let fetchInFlight = false;
    const fetchMonadTxAndStats = async () => {
      if (fetchInFlight) return;
      fetchInFlight = true;
      setMonadTxRefreshing(true);
      try {
        const [txRes, statsRes] = await Promise.allSettled([
          backend.getMonadTransactions(instance.id, 50),
          backend.getMonadStats(instance.id),
        ]);
        if (cancelled) return;
        if (txRes.status === "fulfilled") {
          const newTxs = txRes.value.transactions;
          setMonadTransactions((prev) =>
            newTxs.length === 0 && prev && prev.length > 0 ? prev : newTxs
          );
        }
        if (statsRes.status === "fulfilled") {
          setMonadStats(statsRes.value);
        }
      } catch { /* keep previous */ }
      finally {
        fetchInFlight = false;
        if (!cancelled) setMonadTxRefreshing(false);
      }
    };
    fetchMonadTxAndStats();
    const interval = setInterval(fetchMonadTxAndStats, 12000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [instance?.id, monadAddress]);

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
    llmProvider?: "openrouter" | "openai-codex";
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
        llmProvider: config.llmProvider,
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
    
    // Determine active provider for custom model prefix
    const activeProvider = anthropicStatus?.connected ? "anthropic" : 
                          openaiStatus?.connected ? "openai-codex" : 
                          "openrouter";
    
    const resolvedModel =
      settingsModel === CUSTOM_MODEL_ID
        ? `${activeProvider}/${customSettingsModel}`
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

  // ── OpenAI Codex auth handlers ─────────────────────────────────
  const fetchOpenaiStatus = useCallback(async () => {
    try {
      const status = await backend.openaiStatus();
      setOpenaiStatus(status);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (activeTab === "settings" && instance) {
      fetchOpenaiStatus();
    }
  }, [activeTab, instance?.id, fetchOpenaiStatus]);

  const startOpenaiAuth = async () => {
    setOpenaiLoading(true);
    try {
      const pkce = await generatePKCE();
      pkceRef.current = pkce;
      const url = getAuthorizeUrl(pkce.challenge, pkce.state);

      // Open OpenAI authorize page in a new tab
      window.open(url, "_blank");

      // Show the "paste callback URL" state
      setOpenaiWaitingForCode(true);
    } catch (err) {
      setAlertModal({
        open: true,
        title: "Connection Failed",
        message: err instanceof Error ? err.message : "Failed to start OpenAI auth",
        type: "error",
      });
    } finally {
      setOpenaiLoading(false);
    }
  };

  const handleCallbackUrlSubmit = async () => {
    if (!pkceRef.current) return;

    const result = extractCodeFromUrl(openaiCallbackUrl);
    if (!result) {
      setAlertModal({
        open: true,
        title: "Invalid URL",
        message: "Could not find authorization code in the URL. Make sure you copied the full URL from your browser.",
        type: "error",
      });
      return;
    }

    if (result.state !== pkceRef.current.state) {
      setAlertModal({
        open: true,
        title: "State Mismatch",
        message: "State mismatch. Please try the flow again.",
        type: "error",
      });
      return;
    }

    setOpenaiLoading(true);
    try {
      await backend.openaiExchange(result.code, pkceRef.current.verifier);
      setOpenaiWaitingForCode(false);
      setOpenaiCallbackUrl("");
      pkceRef.current = null;
      await fetchOpenaiStatus();
      setAlertModal({
        open: true,
        title: "OpenAI Connected",
        message: "Your OpenAI account has been connected. Your bot is restarting with the new provider.",
        type: "success",
      });
      // Refresh instance status since container was restarted
      setInstance((prev) => prev ? { ...prev, status: "restarting" } : null);
    } catch (err) {
      setAlertModal({
        open: true,
        title: "Exchange Failed",
        message: err instanceof Error ? err.message : "Failed to exchange code",
        type: "error",
      });
    } finally {
      setOpenaiLoading(false);
    }
  };

  const cancelOpenaiAuth = () => {
    setOpenaiWaitingForCode(false);
    setOpenaiCallbackUrl("");
    setOpenaiLoading(false);
    pkceRef.current = null;
  };

  const disconnectOpenai = async () => {
    setOpenaiLoading(true);
    try {
      await backend.openaiDisconnect();
      await fetchOpenaiStatus();
      setAlertModal({
        open: true,
        title: "OpenAI Disconnected",
        message: "Reverted to OpenRouter. Your bot is restarting.",
        type: "success",
      });
      setInstance((prev) => prev ? { ...prev, status: "restarting" } : null);
    } catch (err) {
      setAlertModal({
        open: true,
        title: "Disconnect Failed",
        message: err instanceof Error ? err.message : "Failed to disconnect",
        type: "error",
      });
    } finally {
      setOpenaiLoading(false);
    }
  };

  // ── Anthropic (Claude) auth handlers ─────────────────────────────────
  const fetchAnthropicStatus = useCallback(async () => {
    try {
      const status = await backend.anthropicStatus();
      setAnthropicStatus(status);
    } catch {
      // ignore - user might not have anthropic connected
    }
  }, []);

  // Fetch anthropic status when settings tab opens
  useEffect(() => {
    if (activeTab === "settings" && instance) {
      fetchAnthropicStatus();
    }
  }, [activeTab, instance?.id, fetchAnthropicStatus]);

  const handleAnthropicSubmit = async () => {
    if (!anthropicSetupToken.trim()) return;
    setAnthropicLoading(true);
    try {
      await backend.anthropicPasteToken(anthropicSetupToken.trim());
      await fetchAnthropicStatus();
      setAnthropicSetupToken("");
      setShowAnthropicInput(false);
      setAlertModal({
        open: true,
        title: "Claude Connected",
        message: "Your Claude subscription is now active. Your bot is restarting.",
        type: "success",
      });
      setInstance((prev) => prev ? { ...prev, status: "restarting" } : null);
    } catch (err) {
      setAlertModal({
        open: true,
        title: "Connection Failed",
        message: err instanceof Error ? err.message : "Failed to connect Claude",
        type: "error",
      });
    } finally {
      setAnthropicLoading(false);
    }
  };

  const disconnectAnthropic = async () => {
    setAnthropicLoading(true);
    try {
      await backend.anthropicDisconnect();
      await fetchAnthropicStatus();
      setAlertModal({
        open: true,
        title: "Claude Disconnected",
        message: "Reverted to OpenRouter. Your bot is restarting.",
        type: "success",
      });
      setInstance((prev) => prev ? { ...prev, status: "restarting" } : null);
    } catch (err) {
      setAlertModal({
        open: true,
        title: "Disconnect Failed",
        message: err instanceof Error ? err.message : "Failed to disconnect",
        type: "error",
      });
    } finally {
      setAnthropicLoading(false);
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

        {/* ── Live prices ticker ───────────────────────────────────── */}
        {(walletBalance?.solPriceUsd || monadBalance?.monPriceUsd) && (
          <div className="flex items-center gap-3 mb-4 text-[10px] text-[#A8A8A8] font-mono">
            {walletBalance?.solPriceUsd && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
                SOL <span className="text-white/70">${walletBalance.solPriceUsd.toFixed(2)}</span>
              </span>
            )}
            {monadBalance?.monPriceUsd && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9]" />
                MON <span className="text-white/70">${monadBalance.monPriceUsd < 0.01 ? monadBalance.monPriceUsd.toFixed(6) : monadBalance.monPriceUsd.toFixed(4)}</span>
              </span>
            )}
          </div>
        )}

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
                  {subscription.nowpaymentsSubscriptionId && !subscription.nowpaymentsSubscriptionId.startsWith("manual_grant") && (
                    <InfoRow label="Payment" value="Crypto (NOWPayments)" />
                  )}
                  {subscription.nowpaymentsSubscriptionId?.startsWith("manual_grant") && (
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
                  <h3 className="text-sm font-semibold">Wallets</h3>
                </div>
                {(walletAddress || monadAddress) && (
                  <button
                    onClick={() => setActiveTab("wallet")}
                    className="text-xs text-[#2ED0FF] hover:underline"
                  >
                    View all
                  </button>
                )}
              </div>
              {walletAddress || monadAddress ? (
                <div className="space-y-3">
                  {/* Solana address */}
                  {walletAddress && (
                    <div>
                      <div className="text-xs text-[#A8A8A8] mb-1 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
                        Solana
                      </div>
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
                  )}
                  {/* Monad address */}
                  {monadAddress && (
                    <div>
                      <div className="text-xs text-[#A8A8A8] mb-1 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9]" />
                        Monad{monadTestnet ? " (Testnet)" : ""}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="mono text-xs truncate">{monadAddress}</span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(monadAddress);
                            setMonadCopied(true);
                            setTimeout(() => setMonadCopied(false), 2000);
                          }}
                          className="flex-shrink-0 text-[#A8A8A8] hover:text-white transition-colors"
                        >
                          {monadCopied ? (
                            <Check className="w-3 h-3 text-[#34d399]" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Total USD Value + breakdown */}
                  <div>
                    {(() => {
                      const solUsd = walletBalance?.usd ?? 0;
                      const monUsd = monadBalance?.usd ?? 0;
                      const tokensUsd = walletTokens?.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0) ?? 0;
                      const totalUsd = solUsd + monUsd + tokensUsd;
                      return (
                        <>
                          <div className="text-xs text-[#A8A8A8] mb-1">Total Value</div>
                          <div className={`text-2xl font-bold ${totalUsd > 0 ? "text-[#34d399]" : "text-white"}`}>
                            {totalUsd > 0 ? `$${totalUsd.toFixed(2)}` : "$0.00"}
                          </div>
                        </>
                      );
                    })()}
                    {/* Always show SOL + MON breakdown */}
                    <div className="text-xs text-[#A8A8A8] mt-1.5 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
                        <span>
                          {walletBalance ? walletBalance.formatted : "0.0000 SOL"}
                          {walletBalance?.usd != null && walletBalance.usd > 0 && (
                            <span className="text-[#34d399] ml-1">(${walletBalance.usd.toFixed(2)})</span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9]" />
                        <span>
                          {monadBalance ? monadBalance.formatted : "0.0000 MON"}
                          {monadBalance?.usd != null && monadBalance.usd > 0 && (
                            <span className="text-[#34d399] ml-1">(${monadBalance.usd.toFixed(2)})</span>
                          )}
                        </span>
                      </div>
                      {walletTokens && walletTokens.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#FBBF24]" />
                          <span>
                            {walletTokens.length} token{walletTokens.length !== 1 ? "s" : ""}
                            <span className="text-[#FBBF24] ml-1">
                              (${walletTokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0).toFixed(2)})
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <Wallet className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-[#A8A8A8] text-xs">
                    Wallets are created when your bot first starts.
                  </p>
                </div>
              )}
            </div>

            {/* Trading Performance Card */}
            <div className="cyber-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4 text-[#FF2E8C]" />
                <h3 className="text-sm font-semibold">Trading Performance</h3>
              </div>
              {walletStats || monadStats ? (
                <div className="space-y-3">
                  {/* Solana stats */}
                  {walletStats && (
                    <>
                      <div className="text-[10px] text-[#A8A8A8] uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
                        Solana (pump.fun)
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#A8A8A8]">Today P/L</span>
                        <span className={`text-xs font-medium flex items-center gap-1 ${
                          walletStats.today.profit > 0 ? "text-[#34d399]" :
                          walletStats.today.profit < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]"
                        }`}>
                          {walletStats.today.profit > 0 ? <TrendingUp className="w-3 h-3" /> :
                           walletStats.today.profit < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                          {walletStats.today.profit > 0 ? "+" : ""}
                          {walletStats.today.profit.toFixed(4)} SOL
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#A8A8A8]">All-time</span>
                        <span className={`text-xs font-medium ${
                          walletStats.allTime.profit > 0 ? "text-[#34d399]" :
                          walletStats.allTime.profit < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]"
                        }`}>
                          {walletStats.allTime.profit > 0 ? "+" : ""}
                          {walletStats.allTime.profit.toFixed(4)} SOL
                          {walletStats.allTime.trades > 0 && (
                            <span className="text-[#A8A8A8] ml-1">
                              ({walletStats.allTime.winRate.toFixed(0)}% win, {walletStats.allTime.trades} trades)
                            </span>
                          )}
                        </span>
                      </div>
                    </>
                  )}
                  {/* Monad stats */}
                  {monadStats && (walletStats ? <div className="border-t border-white/5" /> : null)}
                  {monadStats && (
                    <>
                      <div className="text-[10px] text-[#A8A8A8] uppercase tracking-wider flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9]" />
                        Monad (nad.fun){monadTestnet ? " - Testnet" : ""}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#A8A8A8]">Today P/L</span>
                        <span className={`text-xs font-medium flex items-center gap-1 ${
                          monadStats.today.profit > 0 ? "text-[#34d399]" :
                          monadStats.today.profit < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]"
                        }`}>
                          {monadStats.today.profit > 0 ? <TrendingUp className="w-3 h-3" /> :
                           monadStats.today.profit < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                          {monadStats.today.profit > 0 ? "+" : ""}
                          {monadStats.today.profit.toFixed(4)} MON
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[#A8A8A8]">All-time</span>
                        <span className={`text-xs font-medium ${
                          monadStats.allTime.profit > 0 ? "text-[#34d399]" :
                          monadStats.allTime.profit < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]"
                        }`}>
                          {monadStats.allTime.profit > 0 ? "+" : ""}
                          {monadStats.allTime.profit.toFixed(4)} MON
                          {monadStats.allTime.trades > 0 && (
                            <span className="text-[#A8A8A8] ml-1">
                              ({monadStats.allTime.winRate.toFixed(0)}% win, {monadStats.allTime.trades} trades)
                            </span>
                          )}
                        </span>
                      </div>
                    </>
                  )}
                  {/* Combined active positions */}
                  <div className="border-t border-white/5" />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#A8A8A8]">Active Positions</span>
                    <span className="text-xs font-medium">
                      {(walletStats?.activePositions ?? 0) + (monadStats?.activePositions ?? 0)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <BarChart3 className="w-8 h-8 text-white/10 mx-auto mb-2" />
                  <p className="text-[#A8A8A8] text-xs">
                    Stats appear after your bot makes trades.
                  </p>
                </div>
              )}
              <button
                onClick={() => setActiveTab("wallet")}
                className="btn-secondary w-full text-sm py-2.5 mt-5 justify-center"
              >
                <Wallet className="w-3.5 h-3.5" />
                View Wallet
              </button>
            </div>

            {/* Recent Activity Card (dual-chain) */}
            <div className="cyber-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="w-4 h-4 text-[#FBBF24]" />
                <h3 className="text-sm font-semibold">Recent Activity</h3>
              </div>
              {(() => {
                // Merge Solana + Monad trades into a unified list sorted by time desc
                type UnifiedTx = {
                  chain: "solana" | "monad";
                  type: string;
                  timestamp: number; // ms
                  label: string;
                  amount: string;
                  amountClass: string;
                  icon: "buy" | "sell" | "receive" | "send" | "other";
                  imageUrl?: string | null;
                  explorerUrl?: string | null;
                  key: string;
                };
                const unified: UnifiedTx[] = [];

                // Solana transactions
                if (walletTransactions) {
                  for (const tx of walletTransactions.slice(0, 6)) {
                    const pt = tx.tokenChanges?.[0];
                    const tokenLabel = pt?.symbol ? `$${pt.symbol}` : null;
                    const typeLabel = tx.type === "buy" && tokenLabel ? `Bought ${tokenLabel}`
                      : tx.type === "sell" && tokenLabel ? `Sold ${tokenLabel}`
                      : tx.type === "receive" ? "Received"
                      : tx.type === "send" ? "Sent"
                      : tx.type === "fee" ? "Fee" : tx.type;
                    const solAmt = tx.solChange ? parseFloat(tx.solChange) : 0;
                    unified.push({
                      chain: "solana",
                      type: tx.type,
                      timestamp: tx.blockTime ? tx.blockTime * 1000 : 0,
                      label: typeLabel,
                      amount: tx.solChange ? `${solAmt > 0 ? "+" : ""}${solAmt.toFixed(4)} SOL` : "",
                      amountClass: solAmt > 0 ? "text-[#34d399]" : solAmt < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]",
                      icon: (tx.type === "buy" || tx.type === "receive") ? "buy" : (tx.type === "sell" || tx.type === "send") ? "sell" : "other",
                      imageUrl: pt?.imageUrl,
                      explorerUrl: tx.signature ? `https://orb.helius.dev/tx/${tx.signature}` : null,
                      key: tx.signature || `sol-${tx.blockTime}`,
                    });
                  }
                }

                // Monad transactions
                if (monadTransactions) {
                  for (const tx of monadTransactions.slice(0, 6)) {
                    const tokenShort = tx.token ? `${tx.token.slice(0, 6)}...` : "token";
                    const typeLabel = tx.type === "buy" ? `Bought ${tokenShort}`
                      : tx.type === "sell" ? `Sold ${tokenShort}` : tx.type;
                    unified.push({
                      chain: "monad",
                      type: tx.type,
                      timestamp: tx.timestamp ? new Date(tx.timestamp).getTime() : 0,
                      label: typeLabel,
                      amount: `${tx.type === "sell" ? "+" : "-"}${tx.monAmount.toFixed(4)} MON`,
                      amountClass: tx.type === "sell" ? "text-[#34d399]" : "text-[#FF2E8C]",
                      icon: tx.type === "buy" ? "buy" : "sell",
                      explorerUrl: null,
                      key: `mon-${tx.timestamp}-${tx.token}`,
                    });
                  }
                }

                // Sort by timestamp desc, take first 5
                unified.sort((a, b) => b.timestamp - a.timestamp);
                const display = unified.slice(0, 5);

                if (display.length === 0) {
                  return (
                    <div className="text-center py-6">
                      <Clock className="w-8 h-8 text-white/10 mx-auto mb-2" />
                      <p className="text-[#A8A8A8] text-xs">
                        No activity yet. Transactions will appear here.
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {display.map((item) => {
                      const content = (
                        <>
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                              item.icon === "buy" ? "bg-[#34d399]/10" : item.icon === "sell" ? "bg-[#FF2E8C]/10" : "bg-white/5"
                            }`}>
                              {item.imageUrl ? (
                                <img src={item.imageUrl} alt="" className="w-full h-full rounded-full object-cover" />
                              ) : item.icon === "buy" ? (
                                <ArrowDownLeft className="w-3 h-3 text-[#34d399]" />
                              ) : item.icon === "sell" ? (
                                <ArrowUpRight className="w-3 h-3 text-[#FF2E8C]" />
                              ) : (
                                <RefreshCw className="w-3 h-3 text-[#A8A8A8]" />
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${item.chain === "solana" ? "bg-[#9945FF]" : "bg-[#836EF9]"}`} />
                                <span className="text-xs font-medium">{item.label}</span>
                              </div>
                              {item.amount && (
                                <span className={`text-xs ml-3 ${item.amountClass}`}>
                                  {item.amount}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-[10px] text-[#A8A8A8]">
                            {item.timestamp ? new Date(item.timestamp).toLocaleDateString() : ""}
                          </span>
                        </>
                      );
                      return item.explorerUrl ? (
                        <a
                          key={item.key}
                          href={item.explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between py-2 border-b border-white/5 last:border-0 hover:bg-white/[0.03] transition-colors rounded-md px-1 -mx-1"
                        >
                          {content}
                        </a>
                      ) : (
                        <div
                          key={item.key}
                          className="flex items-center justify-between py-2 border-b border-white/5 last:border-0"
                        >
                          {content}
                        </div>
                      );
                    })}
                    <button
                      onClick={() => setActiveTab("wallet")}
                      className="text-xs text-[#2ED0FF] hover:underline mt-1"
                    >
                      View all transactions
                    </button>
                  </div>
                );
              })()}
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
            {walletDataLoading ? (
              /* Loading skeleton */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="cyber-card p-5 md:col-span-3">
                  <div className="animate-pulse space-y-3">
                    <div className="h-3 w-24 bg-white/10 rounded" />
                    <div className="h-5 w-80 bg-white/10 rounded" />
                    <div className="h-3 w-20 bg-white/10 rounded" />
                    <div className="h-8 w-36 bg-white/10 rounded" />
                  </div>
                </div>
                <div className="cyber-card p-5 md:col-span-1">
                  <div className="animate-pulse space-y-3">
                    <div className="h-4 w-32 bg-white/10 rounded" />
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/10" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-16 bg-white/10 rounded" />
                        <div className="h-2.5 w-24 bg-white/10 rounded" />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/10" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-20 bg-white/10 rounded" />
                        <div className="h-2.5 w-28 bg-white/10 rounded" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="cyber-card p-5 md:col-span-2">
                  <div className="animate-pulse space-y-3">
                    <div className="h-4 w-40 bg-white/10 rounded" />
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-3 py-2">
                        <div className="w-7 h-7 rounded-full bg-white/10" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 w-28 bg-white/10 rounded" />
                          <div className="h-2.5 w-20 bg-white/10 rounded" />
                        </div>
                        <div className="space-y-1.5 text-right">
                          <div className="h-3 w-16 bg-white/10 rounded ml-auto" />
                          <div className="h-2.5 w-24 bg-white/10 rounded ml-auto" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (walletAddress || monadAddress) ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Balance card - full width top */}
                <div className="cyber-card p-5 md:col-span-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex-1">
                      {/* Solana wallet address */}
                      {walletAddress && (
                        <>
                          <div className="text-xs text-[#A8A8A8] mb-1 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
                            Solana Wallet
                          </div>
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
                        </>
                      )}
                      {/* Monad wallet address */}
                      {monadAddress && (
                        <>
                          <div className="text-xs text-[#A8A8A8] mb-1 flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9]" />
                            Monad Wallet{monadTestnet ? " (Testnet)" : ""}
                          </div>
                          <div className="flex items-center gap-2 mb-3">
                            <span className="mono text-sm">{monadAddress}</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(monadAddress);
                                setMonadCopied(true);
                                setTimeout(() => setMonadCopied(false), 2000);
                              }}
                              className="text-[#A8A8A8] hover:text-white transition-colors"
                            >
                              {monadCopied ? (
                                <Check className="w-3.5 h-3.5 text-[#34d399]" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </>
                      )}
                      {/* Total Portfolio Value (USD) */}
                      <div className="flex items-center gap-2 text-xs text-[#A8A8A8] mb-1 mt-2">
                        <span>Total Portfolio Value</span>
                        {balanceRefreshing && walletBalance !== null && (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        )}
                      </div>
                      {(() => {
                        const solUsd = walletBalance?.usd ?? 0;
                        const monUsd = monadBalance?.usd ?? 0;
                        const tokensUsd = walletTokens?.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0) ?? 0;
                        const totalUsd = solUsd + monUsd + tokensUsd;
                        return (
                          <div className={`text-3xl font-bold ${totalUsd > 0 ? "text-[#34d399]" : "text-white"}`}>
                            {walletBalance === null && monadBalance === null ? (
                              <Loader2 className="w-5 h-5 animate-spin text-[#A8A8A8]" />
                            ) : (
                              totalUsd > 0 ? `$${totalUsd.toFixed(2)}` : "$0.00"
                            )}
                          </div>
                        );
                      })()}
                      {/* Always show SOL + MON breakdown */}
                      <div className="flex items-center gap-4 mt-2 text-xs text-[#A8A8A8] flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
                          {walletBalance ? walletBalance.formatted : "0.0000 SOL"}
                          {walletBalance?.usd != null && walletBalance.usd > 0 && (
                            <span className="text-[#34d399] ml-1">(${walletBalance.usd.toFixed(2)})</span>
                          )}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9]" />
                          {monadBalance ? monadBalance.formatted : "0.0000 MON"}
                          {monadBalance?.usd != null && monadBalance.usd > 0 && (
                            <span className="text-[#34d399] ml-1">(${monadBalance.usd.toFixed(2)})</span>
                          )}
                        </span>
                        {walletTokens && walletTokens.length > 0 && (
                          <span className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#FBBF24]" />
                            {walletTokens.length} token{walletTokens.length !== 1 ? "s" : ""}
                            <span className="text-[#FBBF24] ml-1">
                              (${walletTokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0).toFixed(2)})
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 self-start">
                      {walletAddress && (
                        <a
                          href={`https://orbmarkets.io/address/${walletAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary text-sm py-2.5 px-4 flex items-center gap-2"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[#9945FF]" />
                          Solana
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      {monadAddress && (
                        <a
                          href={`${monadExplorerBase}/address/${monadAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary text-sm py-2.5 px-4 flex items-center gap-2"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[#836EF9]" />
                          Monad{monadTestnet ? " (Testnet)" : ""}
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Chain sub-tabs ──────────────────────────────────── */}
                <div className="md:col-span-3 flex gap-2">
                  {walletAddress && (
                    <button
                      onClick={() => setWalletChain("solana")}
                      className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-full transition-all ${
                        walletChain === "solana"
                          ? "bg-[#9945FF]/20 border border-[#9945FF]/40 text-white"
                          : "bg-white/5 border border-white/10 text-[#A8A8A8] hover:text-white"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-[#9945FF]" />
                      Solana
                      {walletBalance && <span className="text-[10px] ml-1 opacity-70">{walletBalance.formatted}</span>}
                    </button>
                  )}
                  {monadAddress && (
                    <button
                      onClick={() => setWalletChain("monad")}
                      className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-full transition-all ${
                        walletChain === "monad"
                          ? "bg-[#836EF9]/20 border border-[#836EF9]/40 text-white"
                          : "bg-white/5 border border-white/10 text-[#A8A8A8] hover:text-white"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-[#836EF9]" />
                      Monad{monadTestnet ? " (Testnet)" : ""}
                      {monadBalance && <span className="text-[10px] ml-1 opacity-70">{monadBalance.formatted}</span>}
                    </button>
                  )}
                </div>

                {/* ════════════════════════════════════════════════════ */}
                {/*  SOLANA CHAIN VIEW                                  */}
                {/* ════════════════════════════════════════════════════ */}
                {walletChain === "solana" && walletAddress && (
                  <>
                    {/* Solana Tokens */}
                    <div className="cyber-card p-5 md:col-span-1">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold">
                            Token Holdings
                            {walletTokens && (
                              <span className="text-[#A8A8A8] font-normal ml-1">
                                ({walletTokens.length})
                              </span>
                            )}
                          </h3>
                          {tokensRefreshing && walletTokens !== null && (
                            <Loader2 className="w-3 h-3 animate-spin text-[#A8A8A8]" />
                          )}
                        </div>
                        {walletTokens && walletTokens.some(t => t.valueUsd) && (
                          <span className="text-xs font-medium text-[#FBBF24]">
                            ${walletTokens.reduce((sum, t) => sum + (t.valueUsd ?? 0), 0).toFixed(2)}
                          </span>
                        )}
                      </div>
                      {walletTokens === null ? (
                        <div className="flex items-center justify-center py-6 gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-[#A8A8A8]" />
                          <span className="text-[#A8A8A8] text-xs">Loading tokens...</span>
                        </div>
                      ) : walletTokens.length > 0 ? (
                        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                          {walletTokens.map((token) => (
                            <a
                              key={token.mint}
                              href={token.dexUrl || `https://dexscreener.com/solana/${token.mint}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 py-2.5 px-2.5 rounded-lg hover:bg-white/[0.03] transition-colors group"
                            >
                              <div className="w-8 h-8 rounded-full bg-white/5 flex-shrink-0 overflow-hidden">
                                {token.imageUrl ? (
                                  <img src={token.imageUrl} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-[#A8A8A8]">
                                    {(token.symbol || token.mint.slice(0, 2)).slice(0, 2).toUpperCase()}
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-semibold truncate">
                                    {token.symbol || token.mint.slice(0, 6) + "..."}
                                  </span>
                                  {token.name && (
                                    <span className="text-[10px] text-[#A8A8A8] truncate hidden sm:inline">
                                      {token.name}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-[#A8A8A8]">
                                  {parseFloat(token.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                {token.valueUsd != null ? (
                                  <div className="text-xs font-medium">${token.valueUsd.toFixed(token.valueUsd < 0.01 ? 6 : 2)}</div>
                                ) : (
                                  <div className="text-xs text-[#A8A8A8]">--</div>
                                )}
                                {token.pnlPercent != null ? (
                                  <div className={`text-[10px] font-medium ${token.pnlPercent >= 0 ? "text-[#34d399]" : "text-[#FF2E8C]"}`}>
                                    {token.pnlPercent >= 0 ? "+" : ""}{token.pnlPercent.toFixed(1)}% P/L
                                  </div>
                                ) : token.priceUsd != null ? (
                                  <div className="text-[10px] text-[#A8A8A8]">
                                    ${token.priceUsd < 0.0001 ? token.priceUsd.toExponential(2) : token.priceUsd.toFixed(token.priceUsd < 0.01 ? 6 : 4)}
                                  </div>
                                ) : null}
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[#A8A8A8] text-xs py-4 text-center">
                          No tokens held
                        </p>
                      )}
                    </div>

                    {/* Solana Transactions */}
                    <div className="cyber-card p-5 md:col-span-2">
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-sm font-semibold">
                          Transaction History
                          {walletTransactions && (
                            <span className="text-[#A8A8A8] font-normal ml-1">
                              ({walletTransactions.length})
                            </span>
                          )}
                        </h3>
                        {txRefreshing && walletTransactions !== null && (
                          <Loader2 className="w-3 h-3 animate-spin text-[#A8A8A8]" />
                        )}
                      </div>
                      {walletTransactions === null ? (
                        <div className="flex items-center justify-center py-6 gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-[#A8A8A8]" />
                          <span className="text-[#A8A8A8] text-xs">Loading transactions...</span>
                        </div>
                      ) : walletTransactions.length > 0 ? (
                        <div className="space-y-1 max-h-[400px] overflow-y-auto">
                          {walletTransactions.map((tx, txIndex) => {
                            const primaryToken = tx.tokenChanges?.[0];
                            const tokenLabel = primaryToken?.symbol
                              ? `$${primaryToken.symbol}`
                              : primaryToken?.name ? primaryToken.name : null;
                            const typeLabel = tx.type === "buy" && tokenLabel ? `Bought ${tokenLabel}`
                              : tx.type === "sell" && tokenLabel ? `Sold ${tokenLabel}`
                              : tx.type === "receive" ? "Received"
                              : tx.type === "send" ? "Sent"
                              : tx.type === "fee" ? "Fee"
                              : tx.type === "swap" ? "Swap" : tx.type;

                            return (
                              <div
                                key={tx.signature || `tx-${txIndex}`}
                                className="flex items-center justify-between py-2.5 px-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                                    tx.type === "buy" || tx.type === "receive" ? "bg-[#34d399]/10"
                                    : tx.type === "sell" || tx.type === "send" ? "bg-[#FF2E8C]/10" : "bg-white/5"
                                  }`}>
                                    {primaryToken?.imageUrl ? (
                                      <img src={primaryToken.imageUrl} alt="" className="w-full h-full rounded-full object-cover" />
                                    ) : tx.type === "buy" || tx.type === "receive" ? (
                                      <ArrowDownLeft className="w-3.5 h-3.5 text-[#34d399]" />
                                    ) : tx.type === "sell" || tx.type === "send" ? (
                                      <ArrowUpRight className="w-3.5 h-3.5 text-[#FF2E8C]" />
                                    ) : (
                                      <RefreshCw className="w-3.5 h-3.5 text-[#A8A8A8]" />
                                    )}
                                  </div>
                                  <div>
                                    <div className="text-xs font-medium">{typeLabel}</div>
                                    {tx.signature ? (
                                      <a
                                        href={`https://orb.helius.dev/tx/${tx.signature}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] text-[#A8A8A8] hover:text-[#2ED0FF] mono"
                                      >
                                        {tx.signature.slice(0, 12)}...
                                      </a>
                                    ) : (
                                      <span className="text-[10px] text-[#A8A8A8] mono">
                                        {tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleTimeString() : ""}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right">
                                  {tx.solChange && (
                                    <>
                                      <div className={`text-xs font-medium ${
                                        parseFloat(tx.solChange) > 0 ? "text-[#34d399]" : "text-[#FF2E8C]"
                                      }`}>
                                        {parseFloat(tx.solChange) > 0 ? "+" : ""}
                                        {parseFloat(tx.solChange).toFixed(4)} SOL
                                      </div>
                                      {walletBalance?.solPriceUsd && (tx.type === "buy" || tx.type === "sell") && (
                                        <div className="text-[10px] text-[#A8A8A8]">
                                          ${(Math.abs(parseFloat(tx.solChange)) * walletBalance.solPriceUsd).toFixed(2)}
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {tx.type === "sell" && tx.profitSOL != null && (
                                    <div className={`text-[10px] font-medium ${
                                      tx.profitSOL > 0 ? "text-[#34d399]" : tx.profitSOL < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]"
                                    }`}>
                                      P/L: {tx.profitSOL > 0 ? "+" : ""}{tx.profitSOL.toFixed(4)} SOL
                                      {walletBalance?.solPriceUsd && (
                                        <span className="ml-1">(${(tx.profitSOL * walletBalance.solPriceUsd).toFixed(2)})</span>
                                      )}
                                    </div>
                                  )}
                                  <div className="text-[10px] text-[#A8A8A8]">
                                    {tx.blockTime ? new Date(tx.blockTime * 1000).toLocaleString() : "Pending"}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[#A8A8A8] text-xs py-4 text-center">No transactions yet</p>
                      )}
                    </div>
                  </>
                )}

                {/* ════════════════════════════════════════════════════ */}
                {/*  MONAD CHAIN VIEW                                   */}
                {/* ════════════════════════════════════════════════════ */}
                {walletChain === "monad" && monadAddress && (
                  <>
                    {/* Monad Token Holdings (positions) */}
                    <div className="cyber-card p-5 md:col-span-1">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold">
                            Token Positions
                            {monadTokens && (
                              <span className="text-[#A8A8A8] font-normal ml-1">
                                ({monadTokens.length})
                              </span>
                            )}
                          </h3>
                          {monadTokensRefreshing && monadTokens !== null && (
                            <Loader2 className="w-3 h-3 animate-spin text-[#A8A8A8]" />
                          )}
                        </div>
                      </div>
                      {monadTokens === null ? (
                        <div className="flex items-center justify-center py-6 gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-[#A8A8A8]" />
                          <span className="text-[#A8A8A8] text-xs">Loading positions...</span>
                        </div>
                      ) : monadTokens.length > 0 ? (
                        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                          {monadTokens.map((token) => (
                            <a
                              key={token.address}
                              href={`https://nad.fun/token/${token.address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-3 py-2.5 px-2.5 rounded-lg hover:bg-white/[0.03] transition-colors group"
                            >
                              <div className="w-8 h-8 rounded-full bg-[#836EF9]/10 flex-shrink-0 flex items-center justify-center">
                                <CircleDot className="w-4 h-4 text-[#836EF9]" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold truncate mono">
                                  {token.address.slice(0, 6)}...{token.address.slice(-4)}
                                </div>
                                <div className="text-[10px] text-[#A8A8A8]">
                                  {token.buyCount} buy{token.buyCount !== 1 ? "s" : ""}
                                  {token.ageMinutes != null && (
                                    <span className="ml-1">
                                      {token.ageMinutes < 60 ? `${token.ageMinutes}m ago` :
                                       token.ageMinutes < 1440 ? `${Math.floor(token.ageMinutes / 60)}h ago` :
                                       `${Math.floor(token.ageMinutes / 1440)}d ago`}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <div className="text-xs font-medium">
                                  {token.totalCostMON.toFixed(4)} MON
                                </div>
                                <div className="text-[10px] text-[#A8A8A8]">cost basis</div>
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[#A8A8A8] text-xs py-4 text-center">
                          No active positions
                        </p>
                      )}
                    </div>

                    {/* Monad Transactions */}
                    <div className="cyber-card p-5 md:col-span-2">
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-sm font-semibold">
                          Trade History
                          {monadTransactions && (
                            <span className="text-[#A8A8A8] font-normal ml-1">
                              ({monadTransactions.length})
                            </span>
                          )}
                        </h3>
                        {monadTxRefreshing && monadTransactions !== null && (
                          <Loader2 className="w-3 h-3 animate-spin text-[#A8A8A8]" />
                        )}
                      </div>
                      {monadTransactions === null ? (
                        <div className="flex items-center justify-center py-6 gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-[#A8A8A8]" />
                          <span className="text-[#A8A8A8] text-xs">Loading trades...</span>
                        </div>
                      ) : monadTransactions.length > 0 ? (
                        <div className="space-y-1 max-h-[400px] overflow-y-auto">
                          {monadTransactions.map((tx, txIndex) => (
                            <div
                              key={`monad-tx-${txIndex}`}
                              className="flex items-center justify-between py-2.5 px-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                                  tx.type === "buy" ? "bg-[#34d399]/10" : "bg-[#FF2E8C]/10"
                                }`}>
                                  {tx.type === "buy" ? (
                                    <ArrowDownLeft className="w-3.5 h-3.5 text-[#34d399]" />
                                  ) : (
                                    <ArrowUpRight className="w-3.5 h-3.5 text-[#FF2E8C]" />
                                  )}
                                </div>
                                <div>
                                  <div className="text-xs font-medium">
                                    {tx.type === "buy" ? "Bought" : "Sold"}{" "}
                                    <a
                                      href={`https://nad.fun/token/${tx.token}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[#2ED0FF] hover:underline mono"
                                    >
                                      {tx.token.slice(0, 6)}...{tx.token.slice(-4)}
                                    </a>
                                  </div>
                                  <span className="text-[10px] text-[#A8A8A8] mono">
                                    {tx.timestamp ? new Date(tx.timestamp).toLocaleTimeString() : ""}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className={`text-xs font-medium ${
                                  tx.type === "sell" ? "text-[#34d399]" : "text-[#FF2E8C]"
                                }`}>
                                  {tx.type === "sell" ? "+" : "-"}{tx.monAmount.toFixed(4)} MON
                                </div>
                                {tx.type === "sell" && tx.profitMON != null && (
                                  <div className={`text-[10px] font-medium ${
                                    tx.profitMON > 0 ? "text-[#34d399]" : tx.profitMON < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]"
                                  }`}>
                                    P/L: {tx.profitMON > 0 ? "+" : ""}{tx.profitMON.toFixed(4)} MON
                                  </div>
                                )}
                                <div className="text-[10px] text-[#A8A8A8]">
                                  {tx.timestamp ? new Date(tx.timestamp).toLocaleString() : ""}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[#A8A8A8] text-xs py-4 text-center">No trades yet</p>
                      )}
                    </div>

                    {/* Monad Stats Card */}
                    {monadStats && (monadStats.allTime.trades > 0 || monadStats.today.trades > 0) && (
                      <div className="cyber-card p-5 md:col-span-3">
                        <div className="flex items-center gap-2 mb-4">
                          <BarChart3 className="w-4 h-4 text-[#836EF9]" />
                          <h3 className="text-sm font-semibold">Monad Trading Stats</h3>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                          <div>
                            <div className="text-[10px] text-[#A8A8A8] mb-1">Today P/L</div>
                            <div className={`text-sm font-bold ${
                              monadStats.today.profit > 0 ? "text-[#34d399]" :
                              monadStats.today.profit < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]"
                            }`}>
                              {monadStats.today.profit > 0 ? "+" : ""}
                              {monadStats.today.profit.toFixed(4)} MON
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[#A8A8A8] mb-1">All-time P/L</div>
                            <div className={`text-sm font-bold ${
                              monadStats.allTime.profit > 0 ? "text-[#34d399]" :
                              monadStats.allTime.profit < 0 ? "text-[#FF2E8C]" : "text-[#A8A8A8]"
                            }`}>
                              {monadStats.allTime.profit > 0 ? "+" : ""}
                              {monadStats.allTime.profit.toFixed(4)} MON
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[#A8A8A8] mb-1">Win Rate</div>
                            <div className={`text-sm font-bold ${
                              monadStats.allTime.winRate >= 50 ? "text-[#34d399]" : "text-[#FF2E8C]"
                            }`}>
                              {monadStats.allTime.trades > 0 ? `${monadStats.allTime.winRate.toFixed(1)}%` : "N/A"}
                            </div>
                            {monadStats.allTime.trades > 0 && (
                              <div className="text-[10px] text-[#A8A8A8]">
                                {monadStats.allTime.wins}W / {monadStats.allTime.losses}L
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-[10px] text-[#A8A8A8] mb-1">Total Trades</div>
                            <div className="text-sm font-bold">{monadStats.allTime.trades}</div>
                            <div className="text-[10px] text-[#A8A8A8]">
                              {monadStats.activePositions} active
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="cyber-card p-10 text-center">
                <Wallet className="w-12 h-12 text-white/10 mx-auto mb-3" />
                <h3 className="text-base font-semibold mb-1">Wallets Not Created</h3>
                <p className="text-[#A8A8A8] text-sm">
                  Your bot's wallets (Solana + Monad) will be automatically created when it starts
                  for the first time.
                </p>
              </div>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && (
          <div className="animate-fade-in space-y-4">
            {/* Active Provider & Model Card */}
            <div className="cyber-card p-5">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#B6FF2E]" />
                  <h3 className="text-sm font-semibold">AI Model</h3>
                </div>
                {/* Current provider badge */}
                <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold uppercase ${
                  anthropicStatus?.connected 
                    ? "bg-[#B6FF2E]/20 text-[#B6FF2E]" 
                    : openaiStatus?.connected 
                    ? "bg-[#B6FF2E]/20 text-[#B6FF2E]"
                    : "bg-white/10 text-[#A8A8A8]"
                }`}>
                  {anthropicStatus?.connected ? "Claude" : openaiStatus?.connected ? "OpenAI" : "OpenRouter"}
                </span>
              </div>

              {/* Model Selection */}
              <div className="space-y-4">
                {/* Model list - only show usable models */}
                <div className="space-y-1.5">
                  {(() => {
                    // Determine which provider is active
                    const activeProvider = anthropicStatus?.connected ? "anthropic" : 
                                          openaiStatus?.connected ? "openai-codex" : 
                                          "openrouter";
                    
                    // Only show models for the active provider
                    const availableModels = MODELS.filter(m => m.provider === activeProvider);
                    
                    return (
                      <>
                        {availableModels.map((m) => (
                          <label
                            key={m.id}
                            className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                              settingsModel === m.id
                                ? "bg-[#B6FF2E]/10 border border-[#B6FF2E]/30"
                                : "bg-white/5 border border-transparent hover:border-white/10"
                            }`}
                          >
                            <input
                              type="radio"
                              name="model"
                              value={m.id}
                              checked={settingsModel === m.id}
                              onChange={() => {
                                setSettingsModel(m.id);
                                setCustomSettingsModel("");
                              }}
                              className="sr-only"
                            />
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                              settingsModel === m.id ? "border-[#B6FF2E] bg-[#B6FF2E]" : "border-white/30"
                            }`}>
                              {settingsModel === m.id && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{m.name}</span>
                                {m.badge && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#B6FF2E]/20 text-[#B6FF2E] font-semibold">
                                    {m.badge}
                                  </span>
                                )}
                                {m.free && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold">
                                    FREE
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-[#A8A8A8] truncate">{m.desc}</p>
                            </div>
                          </label>
                        ))}

                        {/* Custom model option */}
                        <label
                          className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                            settingsModel === CUSTOM_MODEL_ID
                              ? "bg-[#B6FF2E]/10 border border-[#B6FF2E]/30"
                              : "bg-white/5 border border-transparent hover:border-white/10"
                          }`}
                        >
                          <input
                            type="radio"
                            name="model"
                            value={CUSTOM_MODEL_ID}
                            checked={settingsModel === CUSTOM_MODEL_ID}
                            onChange={() => setSettingsModel(CUSTOM_MODEL_ID)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            settingsModel === CUSTOM_MODEL_ID ? "border-[#B6FF2E] bg-[#B6FF2E]" : "border-white/30"
                          }`}>
                            {settingsModel === CUSTOM_MODEL_ID && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium">Custom Model ID</span>
                            <p className="text-xs text-[#A8A8A8]">Enter any model identifier</p>
                          </div>
                        </label>

                        {/* Custom model input */}
                        {settingsModel === CUSTOM_MODEL_ID && (
                          <div className="pl-7 pr-1 pb-1">
                            <input
                              type="text"
                              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm mono focus:outline-none focus:border-[#B6FF2E]/50 transition-colors"
                              placeholder={
                                anthropicStatus?.connected ? "e.g. claude-3-5-haiku-20241022" :
                                openaiStatus?.connected ? "e.g. gpt-4o" :
                                "e.g. google/gemini-2.5-flash"
                              }
                              value={customSettingsModel}
                              onChange={(e) => setCustomSettingsModel(e.target.value)}
                              autoFocus
                            />
                            <p className="text-[10px] text-[#A8A8A8] mt-1.5">
                              {anthropicStatus?.connected ? "Will use: anthropic/" :
                               openaiStatus?.connected ? "Will use: openai-codex/" :
                               "Will use: openrouter/"}{customSettingsModel || "..."}
                            </p>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Save button */}
                <button
                  onClick={saveSettings}
                  className="btn-primary w-full text-sm py-2.5 justify-center"
                  disabled={actionLoading === "settings"}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${actionLoading === "settings" ? "animate-spin" : ""}`} />
                  {actionLoading === "settings" ? "Saving..." : "Save & Restart Bot"}
                </button>
              </div>
            </div>

            {/* Provider Connections */}
            <div className="cyber-card p-5">
              <div className="flex items-center gap-2 mb-5">
                <Zap className="w-4 h-4 text-[#B6FF2E]" />
                <h3 className="text-sm font-semibold">Provider Connections</h3>
              </div>
              
              <div className="space-y-3">
                {/* OpenRouter */}
                <div className={`p-4 rounded-lg border transition-all ${
                  !anthropicStatus?.connected && !openaiStatus?.connected
                    ? "bg-[#B6FF2E]/5 border-[#B6FF2E]/20"
                    : "bg-white/5 border-white/10"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        !anthropicStatus?.connected && !openaiStatus?.connected ? "bg-[#B6FF2E]/20" : "bg-white/10"
                      }`}>
                        <Cpu className={`w-4 h-4 ${!anthropicStatus?.connected && !openaiStatus?.connected ? "text-[#B6FF2E]" : "text-[#A8A8A8]"}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">OpenRouter</span>
                          {!anthropicStatus?.connected && !openaiStatus?.connected && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#B6FF2E]/20 text-[#B6FF2E] font-semibold">ACTIVE</span>
                          )}
                        </div>
                        <p className="text-xs text-[#A8A8A8]">API key access to many models</p>
                      </div>
                    </div>
                  </div>
                  {/* API Key input for OpenRouter */}
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <label className="text-xs text-[#A8A8A8] mb-1.5 block">
                      API Key <span className="text-white/30">(leave blank to keep current)</span>
                    </label>
                    <input
                      type="password"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm mono focus:outline-none focus:border-[#B6FF2E]/50 transition-colors"
                      placeholder="sk-or-..."
                      value={settingsOrKey}
                      onChange={(e) => setSettingsOrKey(e.target.value)}
                    />
                  </div>
                </div>

                {/* OpenAI Codex */}
                <div className={`p-4 rounded-lg border transition-all ${
                  openaiStatus?.connected ? "bg-[#B6FF2E]/5 border-[#B6FF2E]/20" : "bg-white/5 border-white/10"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        openaiStatus?.connected ? "bg-[#B6FF2E]/20" : "bg-white/10"
                      }`}>
                        <Zap className={`w-4 h-4 ${openaiStatus?.connected ? "text-[#B6FF2E]" : "text-[#A8A8A8]"}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">OpenAI (ChatGPT)</span>
                          {openaiStatus?.connected && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#B6FF2E]/20 text-[#B6FF2E] font-semibold">CONNECTED</span>
                          )}
                          {openaiStatus?.expired && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#FF2E8C]/20 text-[#FF2E8C] font-semibold">EXPIRED</span>
                          )}
                        </div>
                        <p className="text-xs text-[#A8A8A8]">
                          {openaiStatus?.connected 
                            ? openaiStatus.accountId || "ChatGPT Plus/Pro subscription" 
                            : "Use your ChatGPT subscription"}
                        </p>
                      </div>
                    </div>
                    {openaiStatus?.connected ? (
                      <button
                        onClick={disconnectOpenai}
                        disabled={openaiLoading}
                        className="text-xs py-1.5 px-3 text-[#A8A8A8] border border-white/10 rounded-full hover:text-[#FF2E8C] hover:border-[#FF2E8C]/30 transition-all"
                      >
                        {openaiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Disconnect"}
                      </button>
                    ) : openaiWaitingForCode ? (
                      <button onClick={cancelOpenaiAuth} className="text-xs py-1.5 px-3 text-[#A8A8A8] border border-white/10 rounded-full">
                        Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowOpenaiWarning(true)}
                        disabled={openaiLoading}
                        className="text-xs py-1.5 px-3 text-[#B6FF2E] border border-[#B6FF2E]/30 rounded-full hover:bg-[#B6FF2E]/10 transition-all"
                      >
                        {openaiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Connect"}
                      </button>
                    )}
                  </div>
                  {/* Callback URL input when waiting */}
                  {openaiWaitingForCode && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <p className="text-xs text-[#A8A8A8] mb-2">Paste the callback URL from your browser:</p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white mono text-xs focus:outline-none focus:border-[#B6FF2E]/50"
                          placeholder="http://localhost:1455/auth/callback?code=..."
                          value={openaiCallbackUrl}
                          onChange={(e) => setOpenaiCallbackUrl(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleCallbackUrlSubmit()}
                        />
                        <button onClick={handleCallbackUrlSubmit} disabled={!openaiCallbackUrl} className="btn-primary text-xs py-2 px-3">
                          {openaiLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Submit"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Anthropic Claude */}
                <div className={`p-4 rounded-lg border transition-all ${
                  anthropicStatus?.connected ? "bg-[#B6FF2E]/5 border-[#B6FF2E]/20" : "bg-white/5 border-white/10"
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                        anthropicStatus?.connected ? "bg-[#B6FF2E]/20" : "bg-white/10"
                      }`}>
                        <Zap className={`w-4 h-4 ${anthropicStatus?.connected ? "text-[#B6FF2E]" : "text-[#A8A8A8]"}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">Anthropic (Claude)</span>
                          {anthropicStatus?.connected && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#B6FF2E]/20 text-[#B6FF2E] font-semibold">CONNECTED</span>
                          )}
                        </div>
                        <p className="text-xs text-[#A8A8A8]">
                          {anthropicStatus?.connected ? "Claude Pro/Max subscription" : "Use your Claude subscription"}
                        </p>
                      </div>
                    </div>
                    {anthropicStatus?.connected ? (
                      <button
                        onClick={disconnectAnthropic}
                        disabled={anthropicLoading}
                        className="text-xs py-1.5 px-3 text-[#A8A8A8] border border-white/10 rounded-full hover:text-[#FF2E8C] hover:border-[#FF2E8C]/30 transition-all"
                      >
                        {anthropicLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Disconnect"}
                      </button>
                    ) : showAnthropicInput ? (
                      <button onClick={() => { setShowAnthropicInput(false); setAnthropicSetupToken(""); }} className="text-xs py-1.5 px-3 text-[#A8A8A8] border border-white/10 rounded-full">
                        Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowAnthropicInput(true)}
                        disabled={anthropicLoading}
                        className="text-xs py-1.5 px-3 text-[#B6FF2E] border border-[#B6FF2E]/30 rounded-full hover:bg-[#B6FF2E]/10 transition-all"
                      >
                        {anthropicLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Connect"}
                      </button>
                    )}
                  </div>
                  {/* Setup token input when connecting */}
                  {showAnthropicInput && (
                    <div className="mt-3 pt-3 border-t border-white/10">
                      <p className="text-xs text-[#A8A8A8] mb-2">
                        Run <span className="text-white mono bg-white/10 px-1 py-0.5 rounded text-[10px]">claude setup-token</span> and paste below:
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white mono text-xs focus:outline-none focus:border-[#B6FF2E]/50"
                          placeholder="sk-ant-oat01-..."
                          value={anthropicSetupToken}
                          onChange={(e) => setAnthropicSetupToken(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAnthropicSubmit()}
                        />
                        <button onClick={handleAnthropicSubmit} disabled={!anthropicSetupToken} className="btn-primary text-xs py-2 px-3">
                          {anthropicLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Submit"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="cyber-card p-5 border-[#FF2E8C]/10">
              <div className="flex items-center gap-2 mb-4">
                <Trash2 className="w-4 h-4 text-[#FF2E8C]" />
                <h3 className="text-sm font-semibold">Danger Zone</h3>
              </div>
              <div className="bg-[#FF2E8C]/5 border border-[#FF2E8C]/10 rounded-lg p-4">
                <h4 className="text-sm font-medium mb-1">Delete Instance</h4>
                <p className="text-xs text-[#A8A8A8] mb-3">
                  Permanently stop your bot and delete all instance data. Wallet data is preserved but the container will be removed.
                </p>
                <button
                  onClick={() => setDeleteModalOpen(true)}
                  className="text-sm py-2 px-4 text-[#FF2E8C] border border-[#FF2E8C]/30 rounded-full hover:bg-[#FF2E8C]/10 transition-all inline-flex items-center gap-2"
                  disabled={actionLoading !== null}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {actionLoading === "delete" ? "Deleting..." : "Delete Instance"}
                </button>
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
      {/* OpenAI Auth Warning Modal */}
      {showOpenaiWarning && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div onClick={() => setShowOpenaiWarning(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-[#0B0B0B] border border-[#FBBF24]/30 rounded-xl max-w-[400px] w-full shadow-2xl">
            <div className="p-6 space-y-5">
              <div className="flex justify-center">
                <div className="w-12 h-12 rounded-full bg-[#FBBF24]/10 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6 text-[#FBBF24]" />
                </div>
              </div>
              <div className="text-center space-y-3">
                <h3 className="text-xl font-bold m-0">The next page will be blank</h3>
                <p className="text-base text-[#FBBF24] font-bold m-0">That's normal. Don't close it.</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4 space-y-3">
                <p className="text-sm text-white font-bold m-0">1. Sign in to OpenAI</p>
                <p className="text-sm text-white font-bold m-0">2. You'll see a blank page — <span className="text-[#FBBF24]">copy the URL</span></p>
                <p className="text-sm text-white font-bold m-0">3. Come back here and paste it</p>
              </div>
            </div>
            <div className="px-6 pb-6 flex flex-col gap-2">
              <button
                onClick={() => {
                  setShowOpenaiWarning(false);
                  startOpenaiAuth();
                }}
                className="btn-primary w-full text-sm py-3 justify-center"
              >
                Got it, open OpenAI
              </button>
              <button
                onClick={() => setShowOpenaiWarning(false)}
                className="w-full text-xs py-2 text-[#A8A8A8] hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
