import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../services/api/client";
import { queryKeys } from "../../../services/api/queryKeys";
import { FrequencyFilters } from "./useFrequencyQuery";

export function useStatsSummaryQuery(filters: FrequencyFilters) {
  return useQuery({
    queryKey: queryKeys.statsSummary(filters),
    queryFn: () =>
      apiClient.getStatsSummary({
        game_code: filters.gameCode,
        game_variant: filters.gameVariant,
        rule_version: filters.ruleVersion,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      }),
  });
}

