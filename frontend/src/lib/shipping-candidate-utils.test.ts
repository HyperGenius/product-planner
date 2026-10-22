import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { Order } from "@/types/order"
import {
  buildShippingRow,
  buildShippingRows,
  getShippingDeadline,
  summarizeOrderProgress,
} from "./shipping-candidate-utils"

const TODAY = "2026-10-22"

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: "2026-12-31",
    status: "confirmed",
    customer_certainty: null,
    is_scheduled: true,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function makeProcess(overrides: Partial<ProcessProgress>): ProcessProgress {
  return {
    order_id: 1,
    process_routing_id: 1,
    sequence_order: 1,
    process_name: "プレス",
    good_qty: 0,
    order_quantity: 10,
    first_actual_date: null,
    last_actual_date: null,
    status: "not_started",
    completed_by: null,
    planned_end_datetime: null,
    ...overrides,
  }
}

describe("getShippingDeadline", () => {
  it("希望納期を優先する", () => {
    expect(
      getShippingDeadline(
        makeOrder({ desired_deadline: "2026-11-01", confirmed_deadline: "2026-10-25" }),
      ),
    ).toEqual({ date: "2026-11-01", source: "desired" })
  })

  it("希望納期が無ければ確定納期 → シミュ納期に落とす", () => {
    expect(
      getShippingDeadline(
        makeOrder({ desired_deadline: undefined, confirmed_deadline: "2026-10-25", simulated_deadline: "2026-10-20" }),
      ),
    ).toEqual({ date: "2026-10-25", source: "effective" })
    expect(
      getShippingDeadline(makeOrder({ desired_deadline: undefined, simulated_deadline: "2026-10-20" })),
    ).toEqual({ date: "2026-10-20", source: "effective" })
    expect(getShippingDeadline(makeOrder({ desired_deadline: undefined }))).toBeNull()
  })
})

describe("summarizeOrderProgress", () => {
  it("進捗の行が無ければ null（日報なし）", () => {
    expect(summarizeOrderProgress(undefined)).toBeNull()
    expect(summarizeOrderProgress([])).toBeNull()
  })

  it("完了した工程数を数え、sequence_order が最大の工程で最終工程の完了を判定する", () => {
    const summary = summarizeOrderProgress([
      makeProcess({ process_routing_id: 3, sequence_order: 3, status: "completed", completed_by: "quantity" }),
      makeProcess({ process_routing_id: 1, sequence_order: 1, status: "completed", completed_by: "later_process" }),
      makeProcess({ process_routing_id: 2, sequence_order: 2, status: "in_progress" }),
    ])
    expect(summary).toEqual({ completedCount: 2, totalCount: 3, finalProcessCompleted: true })
  })

  it("最終工程以外が完了していても最終工程が未完了なら完了にしない", () => {
    const summary = summarizeOrderProgress([
      makeProcess({ process_routing_id: 1, sequence_order: 1, status: "completed" }),
      makeProcess({ process_routing_id: 2, sequence_order: 2, status: "in_progress" }),
    ])
    expect(summary?.finalProcessCompleted).toBe(false)
  })

  it("sequence_order が無い行は最終工程の判定に使わない", () => {
    expect(
      summarizeOrderProgress([makeProcess({ sequence_order: null, status: "completed" })])
        ?.finalProcessCompleted,
    ).toBe(false)
  })
})

describe("buildShippingRow", () => {
  const completedFinal = [makeProcess({ status: "completed", completed_by: "quantity" })]

  it("A: 最終工程が完了していれば納期が先でも候補", () => {
    const row = buildShippingRow(makeOrder({ desired_deadline: "2026-12-31" }), completedFinal, TODAY)
    expect(row.reasons).toEqual(["final_process_completed"])
  })

  it("進捗が無い注文は A にならず、納期（B・C）だけで判定する", () => {
    expect(buildShippingRow(makeOrder({ desired_deadline: "2026-12-31" }), undefined, TODAY).reasons).toEqual([])
    const overdue = buildShippingRow(makeOrder({ desired_deadline: "2026-10-21" }), undefined, TODAY)
    expect(overdue.reasons).toEqual(["overdue"])
    expect(overdue.progress).toBeNull()
  })

  it("B: 納期が今日より前なら超過、今日は超過にしない", () => {
    const yesterday = buildShippingRow(makeOrder({ desired_deadline: "2026-10-21" }), undefined, TODAY)
    expect(yesterday.reasons).toEqual(["overdue"])
    expect(yesterday.daysRemaining).toBe(-1)

    const today = buildShippingRow(makeOrder({ desired_deadline: TODAY }), undefined, TODAY)
    expect(today.reasons).toEqual(["due_soon"])
    expect(today.daysRemaining).toBe(0)
  })

  it("C: 残り7日未満（6日後まで）が間近で、7日後は候補にしない", () => {
    expect(buildShippingRow(makeOrder({ desired_deadline: "2026-10-28" }), undefined, TODAY).reasons).toEqual([
      "due_soon",
    ])
    const sevenDays = buildShippingRow(makeOrder({ desired_deadline: "2026-10-29" }), undefined, TODAY)
    expect(sevenDays.reasons).toEqual([])
    expect(sevenDays.daysRemaining).toBe(7)
  })

  it("A と B の両方に当たる", () => {
    expect(
      buildShippingRow(makeOrder({ desired_deadline: "2026-10-01" }), completedFinal, TODAY).reasons,
    ).toEqual(["final_process_completed", "overdue"])
  })

  it("納期が無ければ B・C にならない", () => {
    const row = buildShippingRow(makeOrder({ desired_deadline: undefined }), undefined, TODAY)
    expect(row.reasons).toEqual([])
    expect(row.deadline).toBeNull()
    expect(row.daysRemaining).toBeNull()
  })
})

describe("buildShippingRows", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("確定済・生産中だけを対象にし、A かつ B を先頭に、次に納期の古い順（納期なしは末尾）に並べる", () => {
    const orders = [
      makeOrder({ id: 1, desired_deadline: "2026-10-25" }),
      makeOrder({ id: 2, desired_deadline: "2026-10-10", status: "in_progress" }),
      makeOrder({ id: 3, desired_deadline: "2026-10-15" }),
      makeOrder({ id: 4, desired_deadline: undefined }),
      makeOrder({ id: 5, desired_deadline: "2026-10-01", status: "shipped" }),
      makeOrder({ id: 6, desired_deadline: "2026-10-01", status: "draft" }),
      makeOrder({ id: 7, desired_deadline: "2026-11-30" }),
    ]
    const items = [
      makeProcess({ order_id: 3, status: "completed" }),
      makeProcess({ order_id: 7, status: "completed" }),
    ]
    const rows = buildShippingRows(orders, items, TODAY)
    expect(rows.map((r) => r.order.id)).toEqual([3, 2, 1, 7, 4])
  })

  it("今日は JST の暦日で判定する（UTC では前日の JST 0時台）", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    // JST 2026-10-22 00:30（UTC では 10-21）
    vi.setSystemTime(new Date("2026-10-21T15:30:00Z"))
    const rows = buildShippingRows([makeOrder({ desired_deadline: "2026-10-21" })], undefined)
    expect(rows[0].reasons).toEqual(["overdue"])

    // JST 2026-10-21 23:30 なら当日なので超過にしない
    vi.setSystemTime(new Date("2026-10-21T14:30:00Z"))
    expect(
      buildShippingRows([makeOrder({ desired_deadline: "2026-10-21" })], undefined)[0].reasons,
    ).toEqual(["due_soon"])
  })
})
