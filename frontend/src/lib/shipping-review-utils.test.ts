import { describe, expect, it } from "vitest"
import {
  groupOrderReviews,
  groupUnmatchedByStatus,
  toValidShippingPanel,
} from "./shipping-review-utils"
import type { ShipmentOrderReview, ShipmentUnmatchedGroup } from "@/types/shipment"

describe("toValidShippingPanel（Issue #692）", () => {
  it("既知の一覧はそのまま、知らない値・空・#682 のカードのハッシュは①に寄せる", () => {
    expect(toValidShippingPanel("#confirm")).toBe("confirm")
    expect(toValidShippingPanel("#daily-reports")).toBe("daily-reports")
    expect(toValidShippingPanel("")).toBe("ship")
    expect(toValidShippingPanel("#unknown")).toBe("ship")
    expect(toValidShippingPanel("#candidates")).toBe("ship")
    expect(toValidShippingPanel("#review")).toBe("ship")
  })
})

describe("groupUnmatchedByStatus", () => {
  it("原因ごとに分け、並びは保つ", () => {
    const item = (status: ShipmentUnmatchedGroup["status"], code: string) =>
      ({ status, product_code: code }) as ShipmentUnmatchedGroup
    const grouped = groupUnmatchedByStatus([
      item("no_order", "A"),
      item("ambiguous", "B"),
      item("no_order", "C"),
    ])
    expect(grouped.no_order.map((i) => i.product_code)).toEqual(["A", "C"])
    expect(grouped.ambiguous).toHaveLength(1)
    expect(grouped.unmatched_customer).toEqual([])
  })
})

function makeReview(overrides: Partial<ShipmentOrderReview>): ShipmentOrderReview {
  return {
    order_id: 1,
    product_id: 101,
    cause: "missing_report",
    shipped_qty: 100,
    last_sales_date: "2026-10-10",
    final_process_name: "プレス",
    final_good_qty: 0,
    unallocated_qty: 0,
    process_names: [],
    ...overrides,
  }
}

describe("groupOrderReviews（Issue #683）", () => {
  it("原因ごとに製品の単位でまとめ、送品数と良品数を足す", () => {
    const grouped = groupOrderReviews([
      makeReview({ order_id: 1, product_id: 101, shipped_qty: 60, final_good_qty: 10 }),
      makeReview({ order_id: 2, product_id: 102, cause: "no_routing" }),
      makeReview({ order_id: 3, product_id: 101, shipped_qty: 40, final_good_qty: 5 }),
    ])

    expect(grouped.missing_report).toHaveLength(1)
    expect(grouped.missing_report[0]).toMatchObject({
      productId: 101,
      shippedQty: 100,
      finalGoodQty: 15,
    })
    expect(grouped.missing_report[0].reviews.map((r) => r.order_id)).toEqual([1, 3])
    expect(grouped.no_routing.map((g) => g.productId)).toEqual([102])
    expect(grouped.process_mismatch).toEqual([])
  })
})
