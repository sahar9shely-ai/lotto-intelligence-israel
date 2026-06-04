import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../../services/api/client";
import { queryKeys } from "../../../services/api/queryKeys";

export type DrawSort = "draw_date_desc" | "draw_date_asc" | "draw_number_desc" | "draw_number_asc";

export type UseDrawsQueryParams = {
  page: number;
  pageSize: number;
  dateFrom?: string;
  dateTo?: string;
  sort: DrawSort;
};

export function useDrawsQuery(params: UseDrawsQueryParams) {
  return useQuery({
    queryKey: queryKeys.draws(params),
    queryFn: () =>
      apiClient.getDraws({
        page: params.page,
        page_size: params.pageSize,
        date_from: params.dateFrom,
        date_to: params.dateTo,
        sort: params.sort,
      }),
    placeholderData: (previousData) => previousData,
  });
}

