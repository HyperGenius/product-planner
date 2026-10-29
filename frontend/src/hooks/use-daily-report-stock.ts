"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DAILY_REPORT_COVERAGE_QUERY_KEY } from "@/hooks/use-daily-report-coverage"
import { apiClient } from "@/lib/api-client"
import type { StockEstimates, StockFeedbackInput } from "@/types/daily-report-stock"

/**
 * 日報からの作り置き（先行着手）の推定と、現場の指摘のフック (Issue #591)。
 *
 * 推定は cron（10〜15分間隔）が割り付けと一緒に再計算して保存するので、指摘を登録しても推定数が
 * 変わるのは次の集計の後。登録直後は指摘の一覧だけが変わる。照合状況の分類（作り置き）も推定の有無で
 * 決まるので、念のため照合状況も無効化する。
 */
export const DAILY_REPORT_STOCK_QUERY_KEY = ["daily-report-stock"]

export function useStockEstimates() {
  return useQuery<StockEstimates>({
    queryKey: DAILY_REPORT_STOCK_QUERY_KEY,
    queryFn: () => apiClient<StockEstimates>("/daily-reports/stock-estimates"),
  })
}

function useInvalidateStock() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: DAILY_REPORT_STOCK_QUERY_KEY })
    queryClient.invalidateQueries({ queryKey: DAILY_REPORT_COVERAGE_QUERY_KEY })
  }
}

/** 製品の作り置きについての指摘を登録する（既にあれば上書き） */
export function useSaveStockFeedback() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: ({ productId, data }: { productId: number; data: StockFeedbackInput }) =>
      apiClient(`/daily-reports/stock-feedback/${productId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: invalidate,
  })
}

/** 製品の作り置きについての指摘を取り消す */
export function useDeleteStockFeedback() {
  const invalidate = useInvalidateStock()
  return useMutation({
    mutationFn: (productId: number) =>
      apiClient(`/daily-reports/stock-feedback/${productId}`, { method: "DELETE" }),
    onSuccess: invalidate,
  })
}
