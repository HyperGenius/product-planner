"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { DAILY_REPORT_NAMES_QUERY_KEY } from "@/hooks/use-daily-report-names"
import type {
  CustomerMergeCounts,
  CustomerMergeLogEntry,
  CustomerMergePreview,
  CustomerMergeRequest,
} from "@/types/customer"

/** 重複顧客の統合（Issue #610）のフック。 */
const CUSTOMERS_QUERY_KEY = ["customers"]
export const CUSTOMER_MERGE_QUERY_KEY = [...CUSTOMERS_QUERY_KEY, "merge"]
const PREVIEW_KEY = "preview"

function isPreviewQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    CUSTOMER_MERGE_QUERY_KEY.every((k, i) => queryKey[i] === k) &&
    queryKey[CUSTOMER_MERGE_QUERY_KEY.length] === PREVIEW_KEY
  )
}

/** 付け替え・削除の件数と統合を止める理由。統合される顧客が無い間は取得しない */
export function useCustomerMergePreview(request: CustomerMergeRequest | null) {
  const mergeIds = request ? [...request.merge_customer_ids].sort((a, b) => a - b) : []
  return useQuery<CustomerMergePreview>({
    queryKey: [...CUSTOMER_MERGE_QUERY_KEY, PREVIEW_KEY, request?.keep_customer_id ?? null, mergeIds],
    queryFn: () =>
      apiClient<CustomerMergePreview>("/customers/merge/preview", {
        method: "POST",
        body: JSON.stringify({
          keep_customer_id: request!.keep_customer_id,
          merge_customer_ids: mergeIds,
        }),
      }),
    enabled: request !== null && mergeIds.length > 0,
  })
}

/** 統合の履歴（どの顧客をどこへ統合したか）。`enabled` が false の間は取得しない */
export function useCustomerMergeLog(enabled: boolean) {
  return useQuery<CustomerMergeLogEntry[]>({
    queryKey: [...CUSTOMER_MERGE_QUERY_KEY, "log"],
    queryFn: () => apiClient<CustomerMergeLogEntry[]>("/customers/merge-log"),
    enabled,
  })
}

/**
 * 統合の実行（取り消し不可）。
 *
 * 顧客一覧・受注・日報の名寄せを無効化する。プレビューは統合済みの顧客 ID で再取得すると
 * 404 になるので無効化の対象から外す。
 */
export function useMergeCustomers() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CustomerMergeRequest) =>
      apiClient<CustomerMergeCounts>("/customers/merge", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: CUSTOMERS_QUERY_KEY,
        predicate: (query) => !isPreviewQueryKey(query.queryKey),
      })
      queryClient.invalidateQueries({ queryKey: ["orders"] })
      queryClient.invalidateQueries({ queryKey: DAILY_REPORT_NAMES_QUERY_KEY })
    },
  })
}
