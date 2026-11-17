import { describe, expect, it } from "vitest"
import {
  countUnmatchedGroups,
  groupUnmatchedByStatus,
  toValidShippingCard,
} from "./shipping-review-utils"
import type { ShipmentUnmatchedGroup } from "@/types/shipment"

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
