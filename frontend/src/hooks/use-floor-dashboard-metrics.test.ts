import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@/test-utils/render"
import type { Order } from "@/types/order"
import { computeFloorDashboardMetrics, useFloorDashboardMetrics } from "./use-floor-dashboard-metrics"

/**
 * `useFloorDashboardMetrics` / `computeFloorDashboardMetrics` のユニットテスト（Issue #441）。
 * 「今日」判定は JST 基準（`jstTodayIso()`）のため、UTC 深夜をまたぐ時刻でシステム時刻を
 * 固定し、端末TZの影響を受けないことを検証する。
 */

// 基準日: 2026-09-09（水）15:30 UTC = 2026-09-10 00:30 JST（日付が変わる直後）。
// UTC のまま `new Date()` を使うと 09-09 になってしまうケースを検出するための基準時刻。
const NOW_UTC = new Date("2026-09-09T15:30:00Z")

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    quantity: 1,
    status: "confirmed",
    customer_certainty: null,
    is_scheduled: false,
    source_type: "manual",
    tenant_id: "t1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW_UTC)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("computeFloorDashboardMetrics", () => {
  it("orders 未取得時は全カウント0", () => {
    const metrics = computeFloorDashboardMetrics(undefined, "2026-09-10")

    expect(metrics).toEqual({
      inProductionCount: 0,
      overdueCount: 0,
      todayShippingCount: 0,
    })
  })

  it("inProductionCount は confirmed / in_progress のみを数える", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, status: "confirmed" }),
      makeOrder({ id: 2, status: "in_progress" }),
      makeOrder({ id: 3, status: "draft" }),
      makeOrder({ id: 4, status: "pending_approval" }),
      makeOrder({ id: 5, status: "shipped" }),
      makeOrder({ id: 6, status: "completed" }),
      makeOrder({ id: 7, status: "canceled" }),
    ]

    const metrics = computeFloorDashboardMetrics(orders, "2026-09-10")

    expect(metrics.inProductionCount).toBe(2)
  })

  it("overdueCount は受注中のうち confirmed_deadline が本日より前の件数（simulated_deadline へのフォールバック含む）", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, status: "confirmed", confirmed_deadline: "2026-09-09" }), // 超過
      makeOrder({ id: 2, status: "in_progress", confirmed_deadline: "2026-09-10" }), // 本日（超過でない）
      makeOrder({ id: 3, status: "confirmed", confirmed_deadline: "2026-09-11" }), // 未来
      makeOrder({ id: 4, status: "confirmed", simulated_deadline: "2026-09-08" }), // 未確定だが simulated が超過
      makeOrder({ id: 5, status: "confirmed" }), // 納期なし
      makeOrder({ id: 6, status: "draft", confirmed_deadline: "2026-09-01" }), // 受注中でないので対象外
      makeOrder({ id: 7, status: "shipped", confirmed_deadline: "2026-09-01" }), // 受注中でないので対象外
    ]

    const metrics = computeFloorDashboardMetrics(orders, "2026-09-10")

    expect(metrics.overdueCount).toBe(2)
  })

  it("confirmed_deadline がある場合は simulated_deadline より優先する", () => {
    const orders: Order[] = [
      makeOrder({
        id: 1,
        status: "confirmed",
        confirmed_deadline: "2026-09-11",
        simulated_deadline: "2026-09-01", // 超過だが confirmed_deadline があるので無視される
      }),
    ]

    const metrics = computeFloorDashboardMetrics(orders, "2026-09-10")

    expect(metrics.overdueCount).toBe(0)
  })

  it("todayShippingCount は受注中のうち confirmed_deadline が本日の件数", () => {
    const orders: Order[] = [
      makeOrder({ id: 1, status: "confirmed", confirmed_deadline: "2026-09-10" }),
      makeOrder({ id: 2, status: "in_progress", confirmed_deadline: "2026-09-10" }),
      makeOrder({ id: 3, status: "confirmed", confirmed_deadline: "2026-09-09" }),
      makeOrder({ id: 4, status: "confirmed", simulated_deadline: "2026-09-10" }), // confirmed_deadline なしは対象外
      makeOrder({ id: 5, status: "shipped", confirmed_deadline: "2026-09-10" }), // 受注中でないので対象外
    ]

    const metrics = computeFloorDashboardMetrics(orders, "2026-09-10")

    expect(metrics.todayShippingCount).toBe(2)
  })
})

describe("useFloorDashboardMetrics", () => {
  it("JST基準の「今日」で判定する（UTC の日付とはズレるタイミングでも正しい）", () => {
    // NOW_UTC は UTC 09-09 だが JST では 09-10 になる時刻
    const orders: Order[] = [
      makeOrder({ id: 1, status: "confirmed", confirmed_deadline: "2026-09-10" }), // JST の今日
      makeOrder({ id: 2, status: "confirmed", confirmed_deadline: "2026-09-09" }), // JST では前日＝超過
    ]

    const { result } = renderHook(() => useFloorDashboardMetrics(orders))

    expect(result.current.todayShippingCount).toBe(1)
    expect(result.current.overdueCount).toBe(1)
  })
})
