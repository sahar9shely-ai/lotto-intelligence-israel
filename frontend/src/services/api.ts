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
