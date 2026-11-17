import { describe, expect, it } from "vitest"
import {
  countOrderReviewGroups,
  countShippingReview,
  countUnmatchedGroups,
  groupOrderReviews,
  groupUnmatchedByStatus,
  toValidShippingCard,
} from "./shipping-review-utils"
import type { ShipmentOrderReview, ShipmentUnmatchedGroup } from "@/types/shipment"

describe("toValidShippingCard（Issue #682）", () => {
  it("既知のカードはそのまま、知らない値・空は送品の候補に寄せる", () => {
    expect(toValidShippingCard("#review")).toBe("review")
    expect(toValidShippingCard("#candidates")).toBe("candidates")
    expect(toValidShippingCard("")).toBe("candidates")
    expect(toValidShippingCard("#unknown")).toBe("candidates")
  })
})

describe("countUnmatchedGroups", () => {
  it("上限で切る前の原因ごとの件数を足す。取得前は null", () => {
    expect(countUnmatchedGroups(undefined)).toBeNull()
    expect(
      countUnmatchedGroups({
        latest_sales_date: null,
        since: null,
        counts: { unmatched_customer: 1, unmatched_product: 2, no_order: 3, ambiguous: 4 },
        truncated: true,
        items: [],
      }),
    ).toBe(10)
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

describe("countOrderReviewGroups / countShippingReview", () => {
  it("要確認の件数は製品のまとめの数。取得前は null、片方だけ取れたらその数", () => {
    expect(countOrderReviewGroups(undefined)).toBeNull()
    expect(
      countOrderReviewGroups({
        computed_at: null,
        counts: { no_routing: 1, process_mismatch: 0, customer_or_stock: 0, missing_report: 2 },
        items: [
          makeReview({ order_id: 1 }),
          makeReview({ order_id: 2 }),
          makeReview({ order_id: 3, cause: "no_routing" }),
        ],
      }),
    ).toBe(2)
    expect(countShippingReview(null, null)).toBeNull()
    expect(countShippingReview(3, null)).toBe(3)
    expect(countShippingReview(3, 2)).toBe(5)
  })
})
