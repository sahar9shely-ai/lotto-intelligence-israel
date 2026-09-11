import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AUTH_EXPIRED_EVENT, api, getToken, setToken } from "../services/api";
import type { AuthUser } from "../types/auth";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => {
      setToken(null);
      setUser(null);
      setLoading(false);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    setToken(result.access_token);
    setUser(result.user);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
