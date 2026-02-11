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

interface StoredAuth {
  user: AuthUser;
  token: string;
  telegramData: TelegramAuthData;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [telegramData, setTelegramData] = useState<TelegramAuthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasInstance, setHasInstance] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);

  const logout = useCallback(() => {
    setUser(null);
    setTelegramData(null);
    setHasInstance(false);
    setHasSubscription(false);
    backend.clearToken();
    localStorage.removeItem(STORAGE_KEY);
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
        }).catch(() => { /* ignore */ });
        // Check if user has an active subscription
        backend.getSubscription().then(({ subscription }) => {
          setHasSubscription(subscription?.status === 'active');
        }).catch(() => { /* ignore */ });
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
    setLoading(false);

    // Auto-logout on 401 (user deleted from backend, token expired, etc.)
    backend.setAuthErrorHandler(() => {
      console.log('[auth] Session expired or invalid, logging out');
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
