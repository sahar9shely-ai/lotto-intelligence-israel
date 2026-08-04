const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : "בקשה נכשלה");
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  dashboard: () => request<import("./../types/investments").Dashboard>("/api/v1/investments/dashboard"),
  settings: () => request<import("./../types/investments").Settings>("/api/v1/investments/settings"),
  updateSettings: (body: Partial<import("./../types/investments").Settings>) =>
    request<import("./../types/investments").Settings>("/api/v1/investments/settings", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  investors: () => request<import("./../types/investments").Investor[]>("/api/v1/investments/investors"),
  createInvestor: (body: { name: string; phone?: string; notes?: string; is_manager?: boolean }) =>
    request<import("./../types/investments").Investor>("/api/v1/investments/investors", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateInvestor: (
    id: number,
    body: Partial<{ name: string; phone: string; notes: string; is_manager: boolean }>,
  ) =>
    request<import("./../types/investments").Investor>(`/api/v1/investments/investors/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  plans: (params?: { investor_id?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.investor_id != null) qs.set("investor_id", String(params.investor_id));
    if (params?.status) qs.set("status", params.status);
    const suffix = qs.toString() ? `?${qs}` : "";
    return request<import("./../types/investments").Plan[]>(`/api/v1/investments/plans${suffix}`);
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
    request<import("./../types/investments").Plan>("/api/v1/investments/plans", {
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
    request<import("./../types/investments").Plan>(`/api/v1/investments/plans/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
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
    return request<import("./../types/investments").Payment[]>(
      `/api/v1/investments/payments${suffix}`,
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
    request<import("./../types/investments").Payment>(`/api/v1/investments/payments/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  quotes: () => request<import("./../types/investments").Quote[]>("/api/v1/investments/quotes"),
  createQuote: (body: {
    prospect_name: string;
    principal: number;
    monthly_rate_percent: number;
    manager_fee_percent: number;
    duration_months: number;
    notes?: string;
  }) =>
    request<import("./../types/investments").Quote>("/api/v1/investments/quotes", {
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
    request<import("./../types/investments").Quote>(`/api/v1/investments/quotes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  convertQuote: (id: number, body: { start_date: string; phone?: string; notes?: string }) =>
    request<import("./../types/investments").Plan>(`/api/v1/investments/quotes/${id}/convert`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
