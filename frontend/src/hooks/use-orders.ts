"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type {
  Order,
  OrderCreate,
  OrderSimulateRequest,
  OrderSimulateResponse,
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
