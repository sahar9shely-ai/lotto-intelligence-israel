import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type ChatMessage, type UserProfile } from "../services/api";

const TOKEN_KEY = "goturs_token";
const USER_KEY = "goturs_user";
const GUEST_KEY = "goturs_guest";

function defaultGuest(): UserProfile {
  return {
    id: "guest",
    email: "",
    name: "אורח/ת",
    level: 1,
    points: 0,
    roomsOpened: 0,
    friends: 0,
    isPremium: false,
    referralCode: "GOTURS2024",
    favorites: [],
    openedRooms: [],
    achievements: [],
  };
}

function loadStoredUser(): UserProfile {
  try {
    const raw = localStorage.getItem(USER_KEY) || localStorage.getItem(GUEST_KEY);
    if (raw) return JSON.parse(raw) as UserProfile;
  } catch {
    /* ignore */
  }
  return defaultGuest();
}

interface AuthContextValue {
  user: UserProfile;
  token: string | null;
  isGuest: boolean;
  loading: boolean;
  onlineSync: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  continueAsGuest: () => void;
  logout: () => void;
  updateUser: (patch: Partial<UserProfile>) => Promise<void>;
  openRoom: (roomId: string) => Promise<void>;
  toggleFavorite: (roomId: string) => Promise<void>;
  upgradePremium: () => Promise<void>;
  chatMessages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  refreshChat: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_KEY),
  );
  const [user, setUser] = useState<UserProfile>(loadStoredUser);
  const [loading, setLoading] = useState(true);
  const [onlineSync, setOnlineSync] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      from: "them",
      text: "היי! איך הייתה החוויה בחדר הרומנטי?",
      at: new Date().toISOString(),
    },
    {
      id: "2",
      from: "me",
      text: "וואו, ממש קסום 💜",
      at: new Date().toISOString(),
    },
  ]);

  const persist = useCallback((next: UserProfile, nextToken?: string | null) => {
    setUser(next);
    if (nextToken !== undefined) {
      setToken(nextToken);
      if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken);
      else localStorage.removeItem(TOKEN_KEY);
    }
    if (next.id === "guest") {
      localStorage.setItem(GUEST_KEY, JSON.stringify(next));
      localStorage.removeItem(USER_KEY);
    } else {
      localStorage.setItem(USER_KEY, JSON.stringify(next));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (!stored) {
        setLoading(false);
        return;
      }
      try {
        const profile = await api.me(stored);
        if (!cancelled) {
          persist(profile, stored);
          setOnlineSync(true);
          const chat = await api.chat(stored);
          if (!cancelled) setChatMessages(chat.messages);
        }
      } catch {
        if (!cancelled) {
          localStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setOnlineSync(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [persist]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      persist(res.user, res.token);
      setOnlineSync(true);
      const chat = await api.chat(res.token);
      setChatMessages(chat.messages);
    },
    [persist],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const res = await api.register(email, password, name);
      persist(res.user, res.token);
      setOnlineSync(true);
      const chat = await api.chat(res.token);
      setChatMessages(chat.messages);
    },
    [persist],
  );

  const continueAsGuest = useCallback(() => {
    persist(defaultGuest(), null);
    setOnlineSync(false);
  }, [persist]);

  const logout = useCallback(() => {
    persist(defaultGuest(), null);
    setOnlineSync(false);
  }, [persist]);

  const updateUser = useCallback(
    async (patch: Partial<UserProfile>) => {
      const next = { ...user, ...patch };
      persist(next, token);
      if (token) {
        try {
          const synced = await api.sync(token, patch);
          persist(synced, token);
          setOnlineSync(true);
        } catch {
          setOnlineSync(false);
        }
      }
    },
    [persist, token, user],
  );

  const openRoom = useCallback(
    async (roomId: string) => {
      if (user.openedRooms.includes(roomId)) {
        await updateUser({});
        return;
      }
      const openedRooms = [...user.openedRooms, roomId];
      const points = user.points + 100;
      const roomsOpened = user.roomsOpened + 1;
      const level = Math.max(1, Math.floor(points / 500) + 1);
      const achievements = [...user.achievements];
      if (roomsOpened >= 1 && !achievements.includes("lover")) {
        achievements.push("lover");
      }
      if (roomsOpened >= 5 && !achievements.includes("explorer")) {
        achievements.push("explorer");
      }
      if (points >= 2500 && !achievements.includes("legend")) {
        achievements.push("legend");
      }
      await updateUser({
        openedRooms,
        points,
        roomsOpened,
        level,
        achievements,
      });
    },
    [updateUser, user],
  );

  const toggleFavorite = useCallback(
    async (roomId: string) => {
      const favorites = user.favorites.includes(roomId)
        ? user.favorites.filter((id) => id !== roomId)
        : [...user.favorites, roomId];
      await updateUser({ favorites });
    },
    [updateUser, user.favorites],
  );

  const upgradePremium = useCallback(async () => {
    await updateUser({ isPremium: true });
  }, [updateUser]);

  const refreshChat = useCallback(async () => {
    if (!token) return;
    try {
      const chat = await api.chat(token);
      setChatMessages(chat.messages);
    } catch {
      /* keep local */
    }
  }, [token]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (token) {
        try {
          const chat = await api.sendChat(token, trimmed);
          setChatMessages(chat.messages);
          setOnlineSync(true);
          return;
        } catch {
          setOnlineSync(false);
        }
      }
      setChatMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          from: "me",
          text: trimmed,
          at: new Date().toISOString(),
        },
      ]);
    },
    [token],
  );

  const value = useMemo(
    () => ({
      user,
      token,
      isGuest: !token || user.id === "guest",
      loading,
      onlineSync,
      login,
      register,
      continueAsGuest,
      logout,
      updateUser,
      openRoom,
      toggleFavorite,
      upgradePremium,
      chatMessages,
      sendMessage,
      refreshChat,
    }),
    [
      user,
      token,
      loading,
      onlineSync,
      login,
      register,
      continueAsGuest,
      logout,
      updateUser,
      openRoom,
      toggleFavorite,
      upgradePremium,
      chatMessages,
      sendMessage,
      refreshChat,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
