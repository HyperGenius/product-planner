"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DAILY_REPORT_COVERAGE_QUERY_KEY } from "@/hooks/use-daily-report-coverage"
import { apiClient } from "@/lib/api-client"
import type {
  OrderStockAssignments,
  StockAssignmentInput,
  StockEstimates,
  StockFeedbackInput,
} from "@/types/daily-report-stock"

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

/**
 * 受注に引き当てた作り置き（Issue #624）。進捗・推定への反映は次の集計の後なので、登録・取り消しの後は
 * この受注の引き当てだけを取り直す。
 */
function orderStockAssignmentsKey(orderId: number) {
  return [...DAILY_REPORT_STOCK_QUERY_KEY, "order-assignments", orderId]
}

export function useOrderStockAssignments(orderId: number) {
  return useQuery<OrderStockAssignments>({
    queryKey: orderStockAssignmentsKey(orderId),
    queryFn: () =>
      apiClient<OrderStockAssignments>(`/daily-reports/orders/${orderId}/stock-assignments`),
  })
}

/** 受注に作り置きを引き当てる（同じ工程の引き当てがあれば上書き） */
export function useSaveStockAssignment(orderId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: StockAssignmentInput) =>
      apiClient(`/daily-reports/orders/${orderId}/stock-assignments`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orderStockAssignmentsKey(orderId) }),
  })
}

/** 引き当てを取り消す */
export function useDeleteStockAssignment(orderId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (assignmentId: string) =>
      apiClient(`/daily-reports/orders/${orderId}/stock-assignments/${assignmentId}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: orderStockAssignmentsKey(orderId) }),
  })
}
