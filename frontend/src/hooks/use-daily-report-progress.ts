"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { OrderProgress, OrderProgressList } from "@/types/daily-report-progress"

/**
 * 日報の実績による受注の進捗のフック (Issue #491)。
 *
 * 進捗は cron（10〜15分間隔）がテナント単位で再計算して保存するので、画面からは参照するだけ。
 */
export const DAILY_REPORT_PROGRESS_QUERY_KEY = ["daily-report-progress"]

/** `GET /daily-reports/order-progress` の `order_id` の上限（Backend `_MAX_ORDER_IDS`） */
export const ORDER_PROGRESS_MAX_IDS = 500

const PROGRESS_STALE_TIME_MS = 5 * 60 * 1000

/**
 * 複数受注の工程ごとの進捗（ガントチャート用）。受注ごとに引かず1リクエストにまとめる（N+1 にしない）。
 * 上限を超える件数は分割して並列に取得し結合する。`orderIds` が空の間は取得しない。
 */
export function useOrderProgressList(orderIds: readonly number[]) {
  const ids = Array.from(new Set(orderIds)).sort((a, b) => a - b)
  return useQuery<OrderProgressList>({
    queryKey: [...DAILY_REPORT_PROGRESS_QUERY_KEY, "list", ids],
    queryFn: async () => {
      const chunks: number[][] = []
      for (let i = 0; i < ids.length; i += ORDER_PROGRESS_MAX_IDS) {
        chunks.push(ids.slice(i, i + ORDER_PROGRESS_MAX_IDS))
      }
      const results = await Promise.all(
        chunks.map((chunk) => {
          const params = new URLSearchParams()
          chunk.forEach((id) => params.append("order_id", String(id)))
          return apiClient<OrderProgressList>(`/daily-reports/order-progress?${params}`)
        }),
      )
      return {
        computed_at: results[0]?.computed_at ?? null,
        items: results.flatMap((r) => r.items),
      }
    },
    enabled: ids.length > 0,
    staleTime: PROGRESS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

/** 受注1件の工程ごとの進捗（受注詳細用） */
export function useOrderProgress(orderId: number, options?: { enabled?: boolean }) {
  return useQuery<OrderProgress>({
    queryKey: [...DAILY_REPORT_PROGRESS_QUERY_KEY, "order", orderId],
    queryFn: () => apiClient<OrderProgress>(`/orders/${orderId}/progress`),
    enabled: !!orderId && (options?.enabled ?? true),
    staleTime: PROGRESS_STALE_TIME_MS,
  })
}
