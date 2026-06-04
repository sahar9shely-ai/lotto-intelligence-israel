import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../../services/api/client";
import type { SnapshotGenerateRequest } from "../../../services/api/types";

export function useGenerateSnapshotMutation() {
  return useMutation({
    mutationFn: (payload: SnapshotGenerateRequest) => apiClient.generateSnapshot(payload),
  });
}

