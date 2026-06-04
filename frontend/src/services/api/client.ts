import type {
  ApiErrorEnvelope,
  DrawItem,
  DrawListResponse,
  FrequencyResponse,
  HealthResponse,
  ImportDrawsRequest,
  ImportDrawsResponse,
  PairResponse,
  SnapshotGenerateRequest,
  SnapshotGenerateResponse,
  StatsSummaryResponse,
  StrongNumberResponse,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export class ApiClientError extends Error {
  status: number;

  code?: string;

  details?: unknown;

  constructor(params: { status: number; message: string; code?: string; details?: unknown }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let errorPayload: ApiErrorEnvelope | null = null;
    try {
      errorPayload = (await response.json()) as ApiErrorEnvelope;
    } catch {
      errorPayload = null;
    }

    throw new ApiClientError({
      status: response.status,
      message: errorPayload?.error?.message ?? `API request failed with status ${response.status}`,
      code: errorPayload?.error?.code,
      details: errorPayload?.error?.details,
    });
  }

  return (await response.json()) as T;
}

export const apiClient = {
  getHealth: async () => request<HealthResponse>("/health"),
  importDraws: (payload: ImportDrawsRequest) =>
    request<ImportDrawsResponse>("/api/v1/import/draws", { method: "POST", body: payload }),
  getDraws: (query: {
    page?: number;
    page_size?: number;
    game_code?: string;
    game_variant?: string;
    rule_version?: string;
    date_from?: string;
    date_to?: string;
    sort?: "draw_date_desc" | "draw_date_asc" | "draw_number_desc" | "draw_number_asc";
  }) => request<DrawListResponse>("/api/v1/draws", { query }),
  getDrawById: (drawId: string) => request<DrawItem>(`/api/v1/draws/${drawId}`),
  getFrequencyStats: (query: {
    game_code?: string;
    game_variant?: string;
    rule_version?: string;
    date_from?: string;
    date_to?: string;
  }) => request<FrequencyResponse>("/api/v1/stats/frequency", { query }),
  getStrongNumberStats: (query: {
    game_code?: string;
    game_variant?: string;
    rule_version?: string;
    date_from?: string;
    date_to?: string;
  }) => request<StrongNumberResponse>("/api/v1/stats/strong-number", { query }),
  getPairStats: (query: {
    game_code?: string;
    game_variant?: string;
    rule_version?: string;
    date_from?: string;
    date_to?: string;
  }) => request<PairResponse>("/api/v1/stats/pairs", { query }),
  getStatsSummary: (query: {
    game_code?: string;
    game_variant?: string;
    rule_version?: string;
    date_from?: string;
    date_to?: string;
  }) => request<StatsSummaryResponse>("/api/v1/stats/summary", { query }),
  generateSnapshot: (payload: SnapshotGenerateRequest) =>
    request<SnapshotGenerateResponse>("/api/v1/admin/stats/snapshots/generate", { method: "POST", body: payload }),
};

