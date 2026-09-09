import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@/test-utils/render"
import type { Order } from "@/types/order"
import { useDashboardMetrics } from "./use-dashboard-metrics"

/**
 * `useDashboardMetrics` の集計ロジックのユニットテスト（Issue #404）。
 *
 * president 向け KPI で追加した `thisWeekDueCount` / `inProductionCount` /
 * `weeklyConfirmedCount` を中心に検証する。日付は端末 TZ 非依存になるよう
 * `new Date(y, m, d, ...)`（ローカル時刻）で組み立て、システム時刻は
 * 2026-09-09（水）12:00 ローカルに固定する。
 */

// 基準日: 2026-09-09（水）。週の開始が日曜でも月曜でも 09-08〜09-10 は同じ週に入る。
const NOW = new Date(2026, 8, 9, 12, 0, 0)

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    quantity: 1,
    status: "draft",
    customer_certainty: null,
    is_scheduled: false,
    source_type: "manual",
    tenant_id: "t1",
    created_at: new Date(2026, 8, 9, 9, 0, 0).toISOString(),
    updated_at: new Date(2026, 8, 9, 9, 0, 0).toISOString(),
    ...overrides,
  }
}

/** ローカル日付を "YYYY-MM-DD" にする（confirmed_deadline は日付のみ） */
function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useDashboardMetrics", () => {
  it("orders 未取得時は全カウント0・recentOrders は空", () => {
    const { result } = renderHook(() => useDashboardMetrics(undefined))

    expect(result.current).toMatchObject({
      todayDueCount: 0,
      thisWeekDueCount: 0,
      inProductionCount: 0,
      weeklyConfirmedCount: 0,
      recentOrders: [],
    })
  })

  it("thisWeekDueCount は confirmed_deadline が今週の注文だけを数える", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, confirmed_deadline: isoDate(2026, 9, 9) }), // 今日（今週）
      makeOrder({ id: 2, confirmed_deadline: isoDate(2026, 9, 8) }), // 昨日（今週）
      makeOrder({ id: 3, confirmed_deadline: isoDate(2026, 9, 10) }), // 明日（今週）
      makeOrder({ id: 4, confirmed_deadline: isoDate(2026, 9, 25) }), // 先の週
      makeOrder({ id: 5, confirmed_deadline: isoDate(2026, 8, 20) }), // 過去
      makeOrder({ id: 6 }), // confirmed_deadline なし
    ]

    const { result } = renderHook(() => useDashboardMetrics(orders))

    expect(result.current.thisWeekDueCount).toBe(3)
    // 既存の todayDueCount は今日ぶんだけ
    expect(result.current.todayDueCount).toBe(1)
  })

  it("inProductionCount は confirmed / in_progress のみを数える", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, status: "confirmed" }),
      makeOrder({ id: 2, status: "in_progress" }),
      makeOrder({ id: 3, status: "confirmed" }),
      makeOrder({ id: 4, status: "draft" }),
      makeOrder({ id: 5, status: "pending_approval" }),
      makeOrder({ id: 6, status: "shipped" }),
      makeOrder({ id: 7, status: "completed" }),
      makeOrder({ id: 8, status: "canceled" }),
    ]

    const { result } = renderHook(() => useDashboardMetrics(orders))

    expect(result.current.inProductionCount).toBe(3)
  })

  it("weeklyConfirmedCount は confirmed_at が今週以降の注文だけを数える", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, confirmed_at: new Date(2026, 8, 9, 10, 0, 0).toISOString() }), // 今日
      makeOrder({ id: 2, confirmed_at: new Date(2026, 8, 8, 23, 0, 0).toISOString() }), // 昨日（今週）
      makeOrder({ id: 3, confirmed_at: new Date(2026, 8, 1, 10, 0, 0).toISOString() }), // 先週以前
      makeOrder({ id: 4, confirmed_at: null }), // 未確定
      makeOrder({ id: 5 }), // confirmed_at フィールドなし
    ]

    const { result } = renderHook(() => useDashboardMetrics(orders))

    expect(result.current.weeklyConfirmedCount).toBe(2)
  })

  it("既存の集計（draft / confirmed / weekly / recent）は従来どおり", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, status: "draft" }),
      makeOrder({ id: 2, status: "draft" }),
      makeOrder({ id: 3, status: "confirmed" }),
      makeOrder({ id: 4, status: "pending_approval" }),
      makeOrder({
        id: 5,
        status: "confirmed",
        created_at: new Date(2026, 8, 9, 8, 0, 0).toISOString(), // 今週作成
      }),
      makeOrder({
        id: 6,
        status: "draft",
        created_at: new Date(2026, 7, 1, 8, 0, 0).toISOString(), // 先月作成
      }),
    ]

    const { result } = renderHook(() => useDashboardMetrics(orders))

    expect(result.current.draftOrdersCount).toBe(3)
    expect(result.current.confirmedOrdersCount).toBe(2)
    expect(result.current.pendingApprovalCount).toBe(1)
    // id 6 のみ先月、それ以外は既定の created_at（今日）→ 今週作成は5件
    expect(result.current.weeklyOrdersCount).toBe(5)
    expect(result.current.recentOrders).toHaveLength(5)
  })
})
