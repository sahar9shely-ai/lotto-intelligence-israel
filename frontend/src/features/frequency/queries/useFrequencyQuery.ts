import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../services/api/client";
import { queryKeys } from "../../../services/api/queryKeys";

export type FrequencyFilters = {
  gameCode?: string;
  gameVariant?: string;
  ruleVersion?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function useFrequencyQuery(filters: FrequencyFilters) {
  return useQuery({
    queryKey: queryKeys.statsFrequency(filters),
    queryFn: () =>
      apiClient.getFrequencyStats({
        game_code: filters.gameCode,
        game_variant: filters.gameVariant,
        rule_version: filters.ruleVersion,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      }),
  });
}

