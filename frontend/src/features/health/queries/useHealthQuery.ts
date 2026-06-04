import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../services/api/client";
import { queryKeys } from "../../../services/api/queryKeys";

export function useHealthQuery() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: apiClient.getHealth,
    refetchInterval: 30_000,
  });
}

