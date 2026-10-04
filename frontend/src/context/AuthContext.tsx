import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AUTH_EXPIRED_EVENT, api, getToken, setToken } from "../services/api";
import type { AuthUser } from "../types/auth";
import { resetWelcomeSeen } from "../utils/welcomeSplash";
import { detachBrowserPush } from "../services/pushNotifications";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionVersion = useRef(0);
  const transitioning = useRef(false);
  const cleanupQueue = useRef<Promise<void>>(Promise.resolve());

  function queueCleanup(operation: number, serverCleanup = true, preserveSubscription = false) {
    const cleanup = cleanupQueue.current.catch(() => undefined).then(async () => {
      if (sessionVersion.current !== operation) return;
      await detachBrowserPush({ serverCleanup: serverCleanup && Boolean(getToken()), preserveSubscription });
    });
    cleanupQueue.current = cleanup;
    return cleanup;
  }

  const refresh = useCallback(async () => {
    if (transitioning.current) return;
    const operation = sessionVersion.current;
    const token = getToken();
    const current = () => operation === sessionVersion.current && getToken() === token;
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      if (!current()) return;
      setUser(me);
    } catch {
      if (!current()) return;
      setToken(null);
      setUser(null);
      setLoading(false);
    } finally {
      if (current()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => {
      // An intentional account transition already owns cleanup. Preserve its pending new login.
      if (!transitioning.current) {
        const operation = ++sessionVersion.current;
        void queueCleanup(operation, false, true).catch(() => undefined);
      }
      setToken(null);
      setUser(null);
      setLoading(false);
      resetWelcomeSeen();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const operation = ++sessionVersion.current;
    transitioning.current = true;
    try {
      const replacingSession = Boolean(getToken());
      await queueCleanup(operation, replacingSession, !replacingSession);
      if (sessionVersion.current !== operation) throw new Error("בקשת ההתחברות הוחלפה. נסו שוב.");
      setToken(null);
      setUser(null);
      const result = await api.login(username, password);
      if (sessionVersion.current !== operation) throw new Error("בקשת ההתחברות הוחלפה. נסו שוב.");
      setToken(result.access_token);
      setUser(result.user);
    } finally {
      if (sessionVersion.current === operation) {
        transitioning.current = false;
        setLoading(false);
      }
    }
  }, []);

  const logout = useCallback(async () => {
    const operation = ++sessionVersion.current;
    transitioning.current = true;
    try {
      // Logout disables this account's delivery marker without erasing the device's notification opt-in.
      await queueCleanup(operation, false, true);
      if (sessionVersion.current !== operation) return;
      setToken(null);
      setUser(null);
      resetWelcomeSeen();
    } finally {
      if (sessionVersion.current === operation) {
        transitioning.current = false;
        setLoading(false);
      }
    }
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
