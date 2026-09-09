"use client"

import { useMemo } from "react"
import { addDays, parseISO, startOfDay, startOfWeek } from "date-fns"
import { ja } from "date-fns/locale"
import type { Order } from "@/types/order"

/**
 * 「生産中」とみなす受注ステータス（Issue #404 / #400）。
 * `confirmed`（承認確定済み・未着手）と `in_progress`（着手済み）の2つ。
 * `shipped` / `completed` は生産が終わっているため含めない。
 */
const IN_PRODUCTION_STATUSES: readonly Order["status"][] = ["confirmed", "in_progress"]

/**
 * ダッシュボードで表示する集計値。
 * `todayDueCount` 〜 `recentOrders` は現行 `app/page.tsx` の `useMemo` 群を切り出したもの。
 * `thisWeekDueCount` 以降は president 向け KPI（Issue #404）で追加した集計。
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
  /** 今週が納期（confirmed_deadline が今週の範囲内）の注文数（Issue #404） */
  thisWeekDueCount: number
  /** 生産中（status が confirmed / in_progress）の注文総数（Issue #404） */
  inProductionCount: number
  /** 今週 confirm された（confirmed_at が今週）注文数（Issue #404） */
  weeklyConfirmedCount: number
}

/**
 * 注文一覧からダッシュボードの集計値を導出する。
 * `orders` 未取得（undefined）時は全カウント0・`recentOrders` は空配列を返す。
 */
export function useDashboardMetrics(orders: Order[] | undefined): DashboardMetrics {
  const today = useMemo(() => startOfDay(new Date()), [])
  const tomorrow = useMemo(() => addDays(today, 1), [today])
  const weekStart = useMemo(() => startOfWeek(today, { locale: ja }), [today])
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])

  const todayDueCount = useMemo(() => {
    return (
      orders?.filter((order) => {
        if (!order.confirmed_deadline) return false
        // confirmed_deadline は "YYYY-MM-DD"。new Date() だと UTC 解釈になり
        // 端末のタイムゾーン次第で判定が1日ズレるため parseISO でローカル日付として解釈する
        const deadline = parseISO(order.confirmed_deadline)
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

  const thisWeekDueCount = useMemo(() => {
    return (
      orders?.filter((order) => {
        if (!order.confirmed_deadline) return false
        // confirmed_deadline は "YYYY-MM-DD"。todayDueCount と同様 parseISO でローカル日付として解釈する
        const deadline = parseISO(order.confirmed_deadline)
        return deadline >= weekStart && deadline < weekEnd
      }).length ?? 0
    )
  }, [orders, weekStart, weekEnd])

  const inProductionCount = useMemo(() => {
    return (
      orders?.filter((order) => IN_PRODUCTION_STATUSES.includes(order.status)).length ?? 0
    )
  }, [orders])

  const weeklyConfirmedCount = useMemo(() => {
    // confirmed_at は時刻・TZ 付きタイムスタンプなので new Date() で可（created_at と同様）
    return (
      orders?.filter((order) => order.confirmed_at && new Date(order.confirmed_at) >= weekStart)
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
    thisWeekDueCount,
    inProductionCount,
    weeklyConfirmedCount,
  }
}
