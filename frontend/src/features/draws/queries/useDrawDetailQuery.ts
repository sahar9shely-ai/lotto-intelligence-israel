import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../services/api/client";
import { queryKeys } from "../../../services/api/queryKeys";

export function useDrawDetailQuery(drawId: string | null) {
  return useQuery({
    queryKey: queryKeys.drawDetail(drawId ?? "none"),
    queryFn: () => apiClient.getDrawById(drawId ?? ""),
    enabled: Boolean(drawId),
  });
}

