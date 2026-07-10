"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type {
  Order,
  OrderAttachment,
  OrderCreate,
  OrderSimulateRequest,
  OrderSimulateResponse,
  OrderSplitRequest,
  OrderSplitResponse,
} from "@/types/order"

// クエリキーを定数化
const ORDERS_QUERY_KEY = ["orders"]

/**
 * 注文一覧を取得するフック
 */
export function useOrders() {
  return useQuery<Order[]>({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => apiClient<Order[]>("/orders"),
  })
}

/**
 * 注文をシミュレーションするフック
 */
export function useSimulateOrder() {
  return useMutation({
    mutationFn: (data: OrderSimulateRequest) =>
      apiClient<OrderSimulateResponse>("/orders/simulate", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  })
}

/**
 * 注文を作成するフック
 */
export function useCreateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: OrderCreate) =>
      apiClient<Order>("/orders", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 注文一覧を再取得
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 注文を更新するフック
 */
export function useUpdateOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<OrderCreate> }) =>
      apiClient<Order>(`/orders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 注文を確定するフック
 * スケジュールを作成し、注文ステータスをconfirmedにする
 */
export function useConfirmOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient(`/orders/${orderId}/confirm`, {
        method: "POST",
      }),
    onSuccess: () => {
      // 注文一覧とスケジュール一覧を再取得
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
    },
  })
}

/**
 * 注文を削除するフック
 */
export function useDeleteOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient(`/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
    },
  })
}

/**
 * 注文を1件取得するフック
 */
export function useOrder(orderId: number) {
  return useQuery<Order>({
    queryKey: ["orders", orderId],
    queryFn: () => apiClient<Order>(`/orders/${orderId}`),
    enabled: !!orderId,
  })
}

/**
 * 注文に紐づく添付ファイル一覧を取得するフック
 */
export function useOrderAttachments(orderId: number) {
  return useQuery<OrderAttachment[]>({
    queryKey: ["orders", orderId, "attachments"],
    queryFn: () => apiClient<OrderAttachment[]>(`/orders/${orderId}/attachments`),
    enabled: !!orderId,
  })
}

/**
 * 誤って1件にマージされた下書き注文を、同じソースを参照するN件の下書きに分割するフック
 */
export function useSplitOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: OrderSplitRequest }) =>
      apiClient<OrderSplitResponse>(`/orders/${id}/split`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY })
    },
  })
}

/**
 * 既存の注文IDでシミュレーションを実行するフック
 */
export function useSimulateOrderById() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (orderId: number) =>
      apiClient<OrderSimulateResponse>(`/orders/${orderId}/simulate`, {
        method: "POST",
      }),
    onSuccess: (_data, orderId) => {
      queryClient.invalidateQueries({ queryKey: ["orders", orderId] })
    },
  })
}
