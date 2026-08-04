import type {
  AuthUser,
  EmailOutboxItem,
  LoginAlert,
  PasswordResetRequestItem,
} from "../types/auth";
import type {
  Dashboard,
  Investor,
  Payment,
  PaymentReport,
  Plan,
  Quote,
  Settings,
} from "../types/investments";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const TOKEN_KEY = "tazrim_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit, auth = true): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    setToken(null);
  }

  if (!response.ok) {
    let detail: unknown = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? body;
    } catch {
      /* ignore */
    }
    let message = "בקשה נכשלה";
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object") {
      // Preserve structured errors (e.g. first-login reset_link)
      message = JSON.stringify(detail);
    } else if (Array.isArray(detail)) {
      message = detail.map((d) => d.msg || JSON.stringify(d)).join(", ");
    }
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ access_token: string; user: AuthUser }>(
      "/api/v1/auth/login",
      { method: "POST", body: JSON.stringify({ username, password }) },
      false,
    ),
  requestPasswordReset: (username: string, note?: string) =>
    request<{ message: string }>(
      "/api/v1/auth/request-password-reset",
      { method: "POST", body: JSON.stringify({ username, note }) },
      false,
    ),
  passwordResetRequests: (pendingOnly = true) =>
    request<PasswordResetRequestItem[]>(
      `/api/v1/auth/password-reset-requests${pendingOnly ? "?pending_only=true" : ""}`,
    ),
  fulfillPasswordReset: (id: number, new_password: string) =>
    request<PasswordResetRequestItem>(
      `/api/v1/auth/password-reset-requests/${id}/fulfill`,
      { method: "POST", body: JSON.stringify({ new_password }) },
    ),
  rejectPasswordReset: (id: number) =>
    request<PasswordResetRequestItem>(
      `/api/v1/auth/password-reset-requests/${id}/reject`,
      { method: "POST" },
    ),
  setUserPassword: (id: number, new_password: string) =>
    request<AuthUser>(`/api/v1/auth/users/${id}/password`, {
      method: "POST",
      body: JSON.stringify({ new_password }),
    }),
  me: () => request<AuthUser>("/api/v1/auth/me"),
  users: () => request<AuthUser[]>("/api/v1/auth/users"),
  updateUser: (
    id: number,
    body: Partial<{
      username: string;
      email: string | null;
      role: string;
      is_active: boolean;
      investor_name: string;
    }>,
  ) =>
    request<AuthUser>(`/api/v1/auth/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  createAccessUser: (body: {
    name: string;
    username: string;
    password: string;
    email?: string;
    role: string;
    phone?: string;
    notes?: string;
  }) =>
    request<AuthUser>("/api/v1/auth/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  loginAlerts: (unreadOnly = false) =>
    request<LoginAlert[]>(
      `/api/v1/auth/login-alerts${unreadOnly ? "?unread_only=true" : ""}`,
    ),
  markAlertRead: (id: number) =>
    request<LoginAlert>(`/api/v1/auth/login-alerts/${id}/read`, { method: "POST" }),
  markAllAlertsRead: () =>
    request<{ message: string }>("/api/v1/auth/login-alerts/read-all", {
      method: "POST",
    }),
  emailOutbox: () => request<EmailOutboxItem[]>("/api/v1/auth/email-outbox"),

  dashboard: () => request<Dashboard>("/api/v1/investments/dashboard"),
  settings: () => request<Settings>("/api/v1/investments/settings"),
  updateSettings: (body: Partial<Settings>) =>
    request<Settings>("/api/v1/investments/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  investors: () => request<Investor[]>("/api/v1/investments/investors"),
  createInvestor: (body: {
    name: string;
    phone?: string;
    notes?: string;
    is_manager?: boolean;
    username?: string;
    password?: string;
    email?: string;
  }) =>
    request<Investor>("/api/v1/investments/investors", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateInvestor: (
    id: number,
    body: Partial<{ name: string; phone: string; notes: string; is_manager: boolean }>,
  ) =>
    request<Investor>(`/api/v1/investments/investors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  plans: (params?: { investor_id?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.investor_id != null) qs.set("investor_id", String(params.investor_id));
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<Plan[]>(`/api/v1/investments/plans${suffix}`);
  },
  createPlan: (body: {
    investor_id: number;
    principal: number;
    monthly_rate_percent: number;
    manager_fee_percent: number;
    start_date: string;
    duration_months: number;
    notes?: string;
    generate_schedule?: boolean;
  }) =>
    request<Plan>("/api/v1/investments/plans", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePlan: (
    id: number,
    body: Partial<{
      principal: number;
      monthly_rate_percent: number;
      manager_fee_percent: number;
      start_date: string;
      duration_months: number;
      status: string;
      notes: string;
      regenerate_schedule: boolean;
    }>,
  ) =>
    request<Plan>(`/api/v1/investments/plans/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deletePlan: (id: number) =>
    request<void>(`/api/v1/investments/plans/${id}`, {
      method: "DELETE",
    }),
  removeFromCalendarYear: (year: number, investor_id: number) =>
    request<{
      year: number;
      investor_id: number;
      deleted_plan_ids: number[];
      deleted_count: number;
    }>(
      `/api/v1/investments/remove-from-calendar-year?year=${year}&investor_id=${investor_id}`,
      { method: "POST" },
    ),
  payments: (params?: {
    investor_id?: number;
    plan_id?: number;
    status?: string;
    year?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.investor_id != null) qs.set("investor_id", String(params.investor_id));
    if (params?.plan_id != null) qs.set("plan_id", String(params.plan_id));
    if (params?.status) qs.set("status", params.status);
    if (params?.year != null) qs.set("year", String(params.year));
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<Payment[]>(`/api/v1/investments/payments${suffix}`);
  },
  paymentReport: (year: number, investor_id?: number) => {
    const qs = new URLSearchParams({ year: String(year) });
    if (investor_id != null) qs.set("investor_id", String(investor_id));
    return request<PaymentReport>(`/api/v1/investments/payment-report?${qs}`);
  },
  openCalendarYear: (year: number) =>
    request<{
      year: number;
      created_count: number;
      skipped_count: number;
      created: Array<Record<string, unknown>>;
      skipped: Array<Record<string, unknown>>;
    }>(`/api/v1/investments/open-calendar-year?year=${year}`, { method: "POST" }),
  markYearPaid: (year: number, investor_id?: number) => {
    const qs = new URLSearchParams({ year: String(year) });
    if (investor_id != null) qs.set("investor_id", String(investor_id));
    return request<{ year: number; marked_count: number }>(
      `/api/v1/investments/payments/mark-year-paid?${qs}`,
      { method: "POST" },
    );
  },
  alignCalendarYear: (year?: number) => {
    const qs = year != null ? `?year=${year}` : "";
    return request<{ aligned: Array<Record<string, unknown>>; count: number }>(
      `/api/v1/investments/align-calendar-year${qs}`,
      { method: "POST" },
    );
  },
  updatePayment: (
    id: number,
    body: Partial<{
      status: string;
      paid_at: string;
      investor_amount: number;
      manager_amount: number;
      notes: string;
    }>,
  ) =>
    request<Payment>(`/api/v1/investments/payments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  quotes: () => request<Quote[]>("/api/v1/investments/quotes"),
  createQuote: (body: {
    prospect_name: string;
    principal: number;
    monthly_rate_percent: number;
    manager_fee_percent: number;
    duration_months: number;
    notes?: string;
  }) =>
    request<Quote>("/api/v1/investments/quotes", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateQuote: (
    id: number,
    body: Partial<{
      prospect_name: string;
      principal: number;
      monthly_rate_percent: number;
      manager_fee_percent: number;
      duration_months: number;
      notes: string;
      status: string;
    }>,
  ) =>
    request<Quote>(`/api/v1/investments/quotes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteQuote: (id: number) =>
    request<void>(`/api/v1/investments/quotes/${id}`, {
      method: "DELETE",
    }),
  convertQuote: (
    id: number,
    body: {
      start_date: string;
      phone?: string;
      notes?: string;
      username: string;
      password: string;
      email?: string;
    },
  ) =>
    request<Plan>(`/api/v1/investments/quotes/${id}/convert`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
