import { describe, expect, it } from "vitest"
import {
  elapsedSince,
  expectedCompletion,
  finalProcessProgress,
  overdueDays,
  sortDeliveryRequests,
} from "./delivery-request-utils"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { OpenDeliveryRequestListItem } from "@/types/order-delivery-request"

function req(id: string, desired: string | null): OpenDeliveryRequestListItem {
  return {
    id,
    order_id: 1,
    kind: "delivery_chase",
    extracted_product_name: null,
    quantity: null,
    requested_date: null,
    body_snippet: null,
    resolved_at: null,
    created_at: "2026-11-01T00:00:00+00:00",
    order_number: null,
    customer_name: null,
    order_quantity: null,
    desired_deadline: desired,
    confirmed_deadline: null,
    simulated_deadline: null,
  }
}

describe("overdueDays", () => {
  it("希望納期を過ぎた日数を返す", () => {
    expect(overdueDays("2026-10-20", "2026-11-05")).toBe(16)
  })
  it("当日・納期前・納期なしは null", () => {
    expect(overdueDays("2026-11-05", "2026-11-05")).toBeNull()
    expect(overdueDays("2026-11-30", "2026-11-05")).toBeNull()
    expect(overdueDays(null, "2026-11-05")).toBeNull()
  })
})

describe("expectedCompletion", () => {
  it("確定値を優先し、無ければシミュ納期", () => {
    expect(expectedCompletion({ confirmed_deadline: "2026-11-10", simulated_deadline: "2026-11-20" })).toBe("2026-11-10")
    expect(expectedCompletion({ confirmed_deadline: null, simulated_deadline: "2026-11-20" })).toBe("2026-11-20")
    expect(expectedCompletion({ confirmed_deadline: null, simulated_deadline: null })).toBeNull()
  })
})

describe("finalProcessProgress", () => {
  const p = (seq: number): ProcessProgress => ({
    order_id: 1,
    process_routing_id: seq,
    sequence_order: seq,
    process_name: `工程${seq}`,
    good_qty: 0,
    order_quantity: 200,
    first_actual_date: null,
    last_actual_date: null,
    status: "not_started",
    completed_by: null,
    planned_end_datetime: null,
  })
  it("sequence_order 最大の工程を返す", () => {
    expect(finalProcessProgress([p(1), p(3), p(2)])?.process_name).toBe("工程3")
  })
  it("進捗が無ければ undefined", () => {
    expect(finalProcessProgress([])).toBeUndefined()
    expect(finalProcessProgress(undefined)).toBeUndefined()
  })
})

describe("sortDeliveryRequests", () => {
  const list = [req("a", null), req("b", "2026-10-30"), req("c", "2026-10-01")]
  it("received は元の順", () => {
    expect(sortDeliveryRequests(list, "received", "2026-11-05").map((r) => r.id)).toEqual(["a", "b", "c"])
  })
  it("overdue は超過日数の大きい順で、無いものは後ろ", () => {
    expect(sortDeliveryRequests(list, "overdue", "2026-11-05").map((r) => r.id)).toEqual(["c", "b", "a"])
  })
})

describe("elapsedSince", () => {
  it("経過を日本語で返す", () => {
    expect(elapsedSince("2026-11-02T00:00:00+00:00", new Date("2026-11-05T00:00:00+00:00"))).toBe("3日")
  })
})
