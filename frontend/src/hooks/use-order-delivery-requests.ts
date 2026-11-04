"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type {
  OpenDeliveryRequestCount,
  OpenDeliveryRequestListItem,
  OrderDeliveryRequest,
} from "@/types/order-delivery-request"

/**
 * 顧客からの督促・分割納入の依頼のフック (Issue #619)。
 *
 * 依頼はメール取り込み（cron）が作る。画面からは参照と「対応済み」の切り替えだけを行い、
 * 受注の納期・数量・ステータスは変えない。
 */
export const DELIVERY_REQUESTS_QUERY_KEY = ["order-delivery-requests"]

/** 受注ごとの未対応の依頼件数（受注一覧の印用）。1リクエストにまとめ、行ごとには引かない */
export function useOpenDeliveryRequestCounts() {
  return useQuery<OpenDeliveryRequestCount[]>({
    queryKey: [...DELIVERY_REQUESTS_QUERY_KEY, "open-counts"],
    queryFn: () => apiClient<OpenDeliveryRequestCount[]>("/orders/delivery-requests/open-counts"),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

/** 未対応の依頼の一覧（紐づけ済み・未紐づけの両方。サイドバーのバッジと同じクエリ。Issue #622） */
export function useOpenDeliveryRequests({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery<OpenDeliveryRequestListItem[]>({
    queryKey: [...DELIVERY_REQUESTS_QUERY_KEY, "open"],
    queryFn: () =>
      apiClient<OpenDeliveryRequestListItem[]>("/orders/delivery-requests?status=open"),
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

/** 受注1件に紐づく依頼（受注詳細用） */
export function useOrderDeliveryRequests(orderId: number) {
  return useQuery<OrderDeliveryRequest[]>({
    queryKey: [...DELIVERY_REQUESTS_QUERY_KEY, "order", orderId],
    queryFn: () => apiClient<OrderDeliveryRequest[]>(`/orders/${orderId}/delivery-requests`),
  })
}

/** 依頼を対応済みにする／未対応に戻す */
export function useResolveDeliveryRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      apiClient<OrderDeliveryRequest>(`/orders/delivery-requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ resolved }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DELIVERY_REQUESTS_QUERY_KEY })
    },
  })
}
