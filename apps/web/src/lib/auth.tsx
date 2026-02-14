import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { backend, type AuthUser } from './api';

interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface AuthContextType {
  user: AuthUser | null;
  /** Raw Telegram data including photo_url */
  telegramData: TelegramAuthData | null;
  loading: boolean;
  /** Whether the user has a deployed instance (checked on login/restore) */
  hasInstance: boolean;
  setHasInstance: (v: boolean) => void;
  /** Whether the user has an active subscription */
  hasSubscription: boolean;
  setHasSubscription: (v: boolean) => void;
  login: (telegramData: TelegramAuthData) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = 'pmc_auth';
const SUBSCRIPTION_CACHE_KEY = 'pmc_subscription';

interface StoredAuth {
  user: AuthUser;
  token: string;
  telegramData: TelegramAuthData;
}

interface StoredSubscription {
  hasSubscription: boolean;
  cachedAt: number;
}

// Helper to get cached subscription from localStorage
function getCachedSubscription(): boolean {
  try {
    const stored = localStorage.getItem(SUBSCRIPTION_CACHE_KEY);
    if (stored) {
      const data = JSON.parse(stored) as StoredSubscription;
      return data.hasSubscription;
    }
  } catch {
    // Ignore parse errors
  }
  return false;
}

// Helper to save subscription to localStorage
function setCachedSubscription(hasSubscription: boolean) {
  localStorage.setItem(
    SUBSCRIPTION_CACHE_KEY,
    JSON.stringify({ hasSubscription, cachedAt: Date.now() } satisfies StoredSubscription)
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [telegramData, setTelegramData] = useState<TelegramAuthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasInstance, setHasInstance] = useState(false);
  // Initialize from cache for instant UI
  const [hasSubscription, setHasSubscriptionState] = useState(getCachedSubscription);

  // Wrapper that updates both state and cache
  const setHasSubscription = useCallback((value: boolean) => {
    setHasSubscriptionState(value);
    setCachedSubscription(value);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setTelegramData(null);
    setHasInstance(false);
    setHasSubscriptionState(false);
    backend.clearToken();
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SUBSCRIPTION_CACHE_KEY);
  }, []);

  // Restore session from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored) as StoredAuth;
        setUser(data.user);
        setTelegramData(data.telegramData);
        backend.setToken(data.token);
        // Check if user has a running instance
        backend.getInstances().then((list) => {
          setHasInstance(list.length > 0);
        }).catch(() => { setHasInstance(false); });
        // Revalidate subscription in background (cache already restored above)
        backend.getSubscription().then(({ subscription }) => {
          const isActive = subscription?.status === 'active';
          setHasSubscription(isActive); // Updates both state and cache
        }).catch(() => { setHasSubscription(false); });
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);

    // Auto-logout on 401 (user deleted from backend, token expired, etc.)
    backend.setAuthErrorHandler(() => {
      logout();
    });
  }, [logout]);

  const login = async (tgData: TelegramAuthData) => {
    const { user: userData, token } = await backend.loginWithTelegram(
      tgData as unknown as Record<string, unknown>,
    );
    setUser(userData);
    setTelegramData(tgData);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ user: userData, token, telegramData: tgData }),
    );
  };

  return (
    <AuthContext.Provider value={{ user, telegramData, loading, hasInstance, setHasInstance, hasSubscription, setHasSubscription, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
