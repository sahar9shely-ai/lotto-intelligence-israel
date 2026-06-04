import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../services/api/client";
import { queryKeys } from "../../../services/api/queryKeys";
import { FrequencyFilters } from "../../frequency/queries/useFrequencyQuery";

export function useStrongNumberQuery(filters: FrequencyFilters) {
  return useQuery({
    queryKey: queryKeys.statsStrongNumber(filters),
    queryFn: () =>
      apiClient.getStrongNumberStats({
        game_code: filters.gameCode,
        game_variant: filters.gameVariant,
        rule_version: filters.ruleVersion,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      }),
  });
}

