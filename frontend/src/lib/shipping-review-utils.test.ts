import { describe, expect, it } from "vitest"
import {
  groupOrderReviews,
  shippingPageFromLegacyHash,
  shippingPageHref,
} from "./shipping-review-utils"
import type { ShipmentOrderReview } from "@/types/shipment"

describe("shippingPageFromLegacyHash（Issue #693）", () => {
  it("#692 の暫定の一覧のハッシュはそのページへ、#682 の送品の候補は①へ移す", () => {
    expect(shippingPageFromLegacyHash("#ship")).toBe("ship")
    expect(shippingPageFromLegacyHash("#confirm")).toBe("confirm")
    expect(shippingPageFromLegacyHash("#register")).toBe("register")
    expect(shippingPageFromLegacyHash("#ambiguous")).toBe("ambiguous")
    expect(shippingPageFromLegacyHash("#daily-reports")).toBe("daily-reports")
    expect(shippingPageFromLegacyHash("#candidates")).toBe("ship")
  })

  it("#682 の要確認・知らない値・空はハブのまま（null）", () => {
    expect(shippingPageFromLegacyHash("#review")).toBeNull()
    expect(shippingPageFromLegacyHash("#unknown")).toBeNull()
    expect(shippingPageFromLegacyHash("")).toBeNull()
  })

  it("ページの URL はハブの配下", () => {
    expect(shippingPageHref("daily-reports")).toBe("/orders/shipping/daily-reports")
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
