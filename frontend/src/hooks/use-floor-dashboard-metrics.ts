"use client"

import { useMemo } from "react"
import type { Order } from "@/types/order"
import { jstTodayIso } from "@/lib/order-utils"

/**
 * 「受注中」とみなす受注ステータス（Issue #441）。
 * `use-dashboard-metrics.ts` の `IN_PRODUCTION_STATUSES` と同じ定義。
 */
const IN_PRODUCTION_STATUSES: readonly Order["status"][] = ["confirmed", "in_progress"]

export interface FloorDashboardMetrics {
  /** 受注中（status が confirmed / in_progress）の注文数 */
  inProductionCount: number
  /** 受注中のうち、納期（confirmed_deadline。未確定なら simulated_deadline）が本日より前の件数 */
  overdueCount: number
  /** 受注中のうち、confirmed_deadline が本日の件数（本日出荷予定） */
  todayShippingCount: number
}

/** 承認確定後は confirmed_deadline、承認前は simulated_deadline を納期とみなす（CLAUDE.md 納期フィールドの方針に準拠） */
function effectiveDeadline(order: Order): string | undefined {
  return order.confirmed_deadline ?? order.simulated_deadline
}

/**
 * 受注一覧から現場ダッシュボードの KPI 集計値を導出する純粋関数（Issue #441）。
 * `todayIso` は "YYYY-MM-DD"（JST基準の「今日」）で呼び出し側から渡す。
 * `confirmed_deadline` / `simulated_deadline` は日付のみの文字列のため、
 * 文字列同士の比較（ISO 8601 は辞書順＝時系列順）で前後判定する。
 */
export function computeFloorDashboardMetrics(
  orders: Order[] | undefined,
  todayIso: string,
): FloorDashboardMetrics {
  const inProduction =
    orders?.filter((order) => IN_PRODUCTION_STATUSES.includes(order.status)) ?? []

  const overdueCount = inProduction.filter((order) => {
    const deadline = effectiveDeadline(order)
    return !!deadline && deadline < todayIso
  }).length

  const todayShippingCount = inProduction.filter(
    (order) => order.confirmed_deadline === todayIso,
  ).length

  return {
    inProductionCount: inProduction.length,
    overdueCount,
    todayShippingCount,
  }
}

/**
 * 現場ダッシュボードの KPI カード（受注中件数・納期超過件数・本日出荷予定件数）向けフック（Issue #441）。
 * 「今日」の判定は端末TZではなく JST 基準で行う（`jstTodayIso()`）。
 * 常時表示画面のため日付をメモ化で固定せず、レンダーの都度 JST の「今日」を計算し直す。
 */
export function useFloorDashboardMetrics(orders: Order[] | undefined): FloorDashboardMetrics {
  const todayIso = jstTodayIso()
  return useMemo(() => computeFloorDashboardMetrics(orders, todayIso), [orders, todayIso])
}
