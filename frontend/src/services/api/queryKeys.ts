export const queryKeys = {
  health: ["health"] as const,
  draws: (params: Record<string, unknown>) => ["draws", params] as const,
  drawDetail: (drawId: string) => ["draws", "detail", drawId] as const,
  statsFrequency: (params: Record<string, unknown>) => ["stats", "frequency", params] as const,
  statsStrongNumber: (params: Record<string, unknown>) => ["stats", "strong-number", params] as const,
  statsPairs: (params: Record<string, unknown>) => ["stats", "pairs", params] as const,
  statsSummary: (params: Record<string, unknown>) => ["stats", "summary", params] as const,
} as const;

