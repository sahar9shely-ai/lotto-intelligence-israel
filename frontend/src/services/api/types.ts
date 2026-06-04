export type DependencyStatus = {
  postgres: string;
  redis: string;
  queue: string;
};

export type HealthResponse = {
  status: string;
  service: string;
  version: string;
  time_utc: string;
  dependencies: DependencyStatus;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
};

export type ImportDrawRecord = {
  draw_number: number;
  draw_date: string;
  source_record_id: string;
  source_revision: number;
  regular_numbers: number[];
  strong_numbers: number[];
  jackpot_amount?: string;
  currency_code?: string;
};

export type ImportDrawsRequest = {
  source_system: string;
  source_object: string;
  game_code: string;
  game_variant: string;
  rule_version: string;
  triggered_by: string;
  dry_run?: boolean;
  records: ImportDrawRecord[];
};

export type ImportDrawsResponse = {
  import_id: number;
  run_id: string;
  source_checksum_sha256: string;
  status: string;
  records_received: number;
  records_valid: number;
  records_quarantined: number;
  dry_run: boolean;
  outcomes: Array<{
    source_record_id: string;
    draw_number: number;
    draw_date: string;
    accepted: boolean;
    rejection_code: string | null;
    rejection_detail: string | null;
    superseded_draw_revision_id: number | null;
  }>;
  started_at_utc: string;
  ended_at_utc: string;
};

export type DrawItem = {
  draw_uid: string;
  draw_number: number;
  draw_date: string;
  draw_timestamp_utc: string | null;
  source_system: string;
  source_record_id: string;
  source_revision: number;
  jackpot_amount: string | null;
  currency_code: string | null;
  game_code: string;
  game_variant: string;
  rule_version: string;
  regular_numbers: number[];
  strong_numbers: number[];
};

export type DrawListResponse = {
  total_count: number;
  page: number;
  page_size: number;
  items: DrawItem[];
};

export type StatsSnapshotRef = {
  snapshot_id: number;
  snapshot_code: string;
  game_code: string;
  game_variant: string;
  rule_version: string;
  window_start_date: string;
  window_end_date: string;
  published_at_utc: string | null;
};

export type FrequencyResponse = {
  snapshot: StatsSnapshotRef;
  items: Array<{
    number_value: number;
    appearance_count: number;
    draw_count: number;
    frequency_pct: string;
    recency_days: number;
  }>;
};

export type StrongNumberResponse = {
  snapshot: StatsSnapshotRef;
  items: Array<{
    strong_value: number;
    appearance_count: number;
    draw_count: number;
    frequency_pct: string;
  }>;
};

export type PairResponse = {
  snapshot: StatsSnapshotRef;
  items: Array<{
    number_a: number;
    number_b: number;
    cooccurrence_count: number;
    support_pct: string;
  }>;
};

export type StatsSummaryResponse = {
  snapshot: StatsSnapshotRef;
  dataset_hash_sha256: string;
  algorithm_version: string;
  engine_build_id: string;
  draw_count: number;
  regular_number_rows: number;
  strong_number_rows: number;
  pair_rows: number;
  lineage_import_ids: number[];
};

export type SnapshotGenerateRequest = {
  game_code: string;
  game_variant: string;
  rule_version: string;
  date_from?: string;
  date_to?: string;
  dry_run?: boolean;
  triggered_by: string;
};

export type SnapshotGenerateResponse = {
  snapshot_id: number;
  reused_existing: boolean;
  draw_count: number;
  dataset_hash_sha256: string;
  status: string;
};

