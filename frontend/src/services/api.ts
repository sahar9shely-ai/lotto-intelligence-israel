const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export interface OrderRecord {
  id: string;
  kind: "room" | "premium";
  itemId: string;
  title: string;
  amountIls: number;
  method: string;
  paidAt: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  level: number;
  points: number;
  roomsOpened: number;
  friends: number;
  isPremium: boolean;
  phone?: string;
  referralCode: string;
  favorites: string[];
  openedRooms: string[];
  achievements: string[];
  orders?: OrderRecord[];
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export interface ChatMessage {
  id: string;
  from: "me" | "them";
  text: string;
  at: string;
}

export interface CommunityMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  at: string;
  kind?: string;
}

export interface OnlineUser {
  id: string;
  name: string;
  isBot?: boolean;
}

export interface CommunityFeed {
  messages: CommunityMessage[];
  online: OnlineUser[];
  onlineCount: number;
  selfId: string;
}

export interface BotSuggestion {
  label: string;
  path: string;
}

export interface BotReply {
  id: string;
  role: "bot";
  text: string;
  suggestions: BotSuggestion[];
  at: string;
}

export interface BitPayment {
  id: string;
  kind: "room" | "premium";
  itemId: string;
  title: string;
  amountIls: number;
  currency: string;
  status: "pending" | "paid" | "failed";
  method: "bit";
  phone: string;
  bitDeepLink: string;
  bitFallbackUrl: string;
  bitQrPayload: string;
  merchantName: string;
  merchantPhone: string;
  mode: string;
  createdAt: string;
  paidAt?: string | null;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let detail = "בקשה נכשלה";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export const api = {
  register(email: string, password: string, name: string) {
    return request<AuthResponse>("/api/v1/goturs/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
  },

  login(email: string, password: string) {
    return request<AuthResponse>("/api/v1/goturs/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  me(token: string) {
    return request<UserProfile>("/api/v1/goturs/me", {}, token);
  },

  sync(token: string, patch: Partial<UserProfile>) {
    return request<UserProfile>(
      "/api/v1/goturs/me",
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      },
      token,
    );
  },

  chat(token: string) {
    return request<{ messages: ChatMessage[] }>(
      "/api/v1/goturs/chat",
      {},
      token,
    );
  },

  sendChat(token: string, text: string) {
    return request<{ messages: ChatMessage[] }>(
      "/api/v1/goturs/chat",
      {
        method: "POST",
        body: JSON.stringify({ text }),
      },
      token,
    );
  },

  getCommunity(
    token: string | null,
    guest?: { guestId: string; guestName: string },
  ) {
    const params = new URLSearchParams();
    if (!token && guest) {
      params.set("guestId", guest.guestId);
      params.set("guestName", guest.guestName);
    }
    const q = params.toString();
    return request<CommunityFeed>(
      `/api/v1/goturs/community${q ? `?${q}` : ""}`,
      {},
      token,
    );
  },

  sendCommunity(
    text: string,
    token: string | null,
    guest?: { guestId: string; guestName: string },
  ) {
    return request<CommunityFeed>(
      "/api/v1/goturs/community/messages",
      {
        method: "POST",
        body: JSON.stringify({
          text,
          guestId: guest?.guestId,
          guestName: guest?.guestName,
        }),
      },
      token,
    );
  },

  presence(
    token: string | null,
    guest?: { guestId: string; guestName: string },
  ) {
    return request<{
      online: OnlineUser[];
      onlineCount: number;
      selfId: string;
    }>(
      "/api/v1/goturs/community/presence",
      {
        method: "POST",
        body: JSON.stringify({
          guestId: guest?.guestId,
          guestName: guest?.guestName,
        }),
      },
      token,
    );
  },

  botChat(text: string) {
    return request<BotReply>("/api/v1/goturs/bot/chat", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
  },

  createBitPayment(
    payload: { kind: "room" | "premium"; itemId: string; phone: string },
    token?: string | null,
  ) {
    return request<BitPayment>(
      "/api/v1/goturs/payments/bit",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      token,
    );
  },

  getPayment(paymentId: string) {
    return request<BitPayment>(`/api/v1/goturs/payments/${paymentId}`);
  },

  confirmBitPayment(paymentId: string, token?: string | null) {
    return request<{ payment: BitPayment; user: UserProfile | null }>(
      "/api/v1/goturs/payments/bit/confirm",
      {
        method: "POST",
        body: JSON.stringify({ paymentId }),
      },
      token,
    );
  },
};
