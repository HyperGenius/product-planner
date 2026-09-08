"use client"

import { useMemo } from "react"
import { addDays, startOfDay, startOfWeek } from "date-fns"
import { ja } from "date-fns/locale"
import type { Order } from "@/types/order"

/**
 * ダッシュボードで表示する集計値。
 * 現行 `app/page.tsx` の `useMemo` 群をそのまま切り出したもので、挙動は変えていない。
 */
export interface DashboardMetrics {
  /** 今日が納期（confirmed_deadline）の注文数 */
  todayDueCount: number
  /** 未確定（draft）注文数 */
  draftOrdersCount: number
  /** 承認待ち（pending_approval）注文数 */
  pendingApprovalCount: number
  /** 確定済み（confirmed）注文数 */
  confirmedOrdersCount: number
  /** 今週作成された注文数 */
  weeklyOrdersCount: number
  /** 作成日時の新しい順に最大5件 */
  recentOrders: Order[]
}

/**
 * 注文一覧からダッシュボードの集計値を導出する。
 * `orders` 未取得（undefined）時は全カウント0・`recentOrders` は空配列を返す。
 */
export function useDashboardMetrics(orders: Order[] | undefined): DashboardMetrics {
  const today = useMemo(() => startOfDay(new Date()), [])
  const tomorrow = useMemo(() => addDays(today, 1), [today])
  const weekStart = useMemo(() => startOfWeek(today, { locale: ja }), [today])

  const todayDueCount = useMemo(() => {
    return (
      orders?.filter((order) => {
        if (!order.confirmed_deadline) return false
        const deadline = new Date(order.confirmed_deadline)
        return deadline >= today && deadline < tomorrow
      }).length ?? 0
    )
  }, [orders, today, tomorrow])

  const draftOrdersCount = useMemo(() => {
    return orders?.filter((order) => order.status === "draft").length ?? 0
  }, [orders])

  const pendingApprovalCount = useMemo(() => {
    return orders?.filter((order) => order.status === "pending_approval").length ?? 0
  }, [orders])

  const confirmedOrdersCount = useMemo(() => {
    return orders?.filter((order) => order.status === "confirmed").length ?? 0
  }, [orders])

  const weeklyOrdersCount = useMemo(() => {
    return (
      orders?.filter((order) => order.created_at && new Date(order.created_at) >= weekStart)
        .length ?? 0
    )
  }, [orders, weekStart])

  const recentOrders = useMemo(() => {
    if (!orders) return []
    return [...orders]
      .sort(
        (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
      )
      .slice(0, 5)
  }, [orders])

  return {
    todayDueCount,
    draftOrdersCount,
    pendingApprovalCount,
    confirmedOrdersCount,
    weeklyOrdersCount,
    recentOrders,
  }
}
