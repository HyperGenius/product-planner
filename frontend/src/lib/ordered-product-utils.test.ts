import { describe, expect, it } from "vitest"
import type { OrderedProductCandidate } from "@/types/daily-report-names"
import {
  orderedProductSummary,
  rankOrderedProducts,
  trigramSimilarity,
} from "./ordered-product-utils"

/** 受注の製品（Issue #704）。品名はダミー値 */
function product(overrides: Partial<OrderedProductCandidate>): OrderedProductCandidate {
  return {
    product_id: 1,
    name: "ピン",
    code: null,
    order_count: 1,
    nearest_deadline: null,
    order_number: null,
    customer_order_no: null,
    quantity: null,
    ...overrides,
  }
}

describe("trigramSimilarity", () => {
  it("同じ文字列は1、重なりが無ければ0", () => {
    expect(trigramSimilarity("シャフト", "シャフト")).toBe(1)
    expect(trigramSimilarity("シャフト", "カラー")).toBe(0)
    expect(trigramSimilarity("", "カラー")).toBe(0)
  })

  it("全角・半角と大文字・小文字の違いは同じに扱う", () => {
    expect(trigramSimilarity("ＡＢ－１２", "ab-12")).toBe(1)
  })

  it("共通の3文字の組が多いほど高い", () => {
    expect(trigramSimilarity("シャフト", "シャフト 長")).toBeGreaterThan(
      trigramSimilarity("シャフト", "シャフ"),
    )
  })
})

describe("rankOrderedProducts", () => {
  it("品名・品番の近いほうで、日報の品名に近い順に並べる", () => {
    const ranked = rankOrderedProducts("S-12 シャフト", [
      product({ product_id: 1, name: "カラー" }),
      product({ product_id: 2, name: "軸", code: "S-12" }),
      product({ product_id: 3, name: "シャフト S-12" }),
    ])
    expect(ranked.map((p) => p.product_id)).toEqual([3, 2, 1])
  })

  it("同じ近さなら API の並び（希望納期の近い順）のまま", () => {
    const ranked = rankOrderedProducts("ピン", [
      product({ product_id: 5, name: "カラー" }),
      product({ product_id: 4, name: "ナット" }),
    ])
    expect(ranked.map((p) => p.product_id)).toEqual([5, 4])
  })
})

describe("orderedProductSummary", () => {
  it("1注文なら注文番号・数量・希望納期", () => {
    expect(
      orderedProductSummary(
        product({ order_number: "A-001", quantity: 1500, nearest_deadline: "2026-12-05" }),
      ),
    ).toBe("A-001・数量 1,500・希望納期 2026/12/05")
  })

  it("注文番号が無ければ顧客の注文番号、無い項目は省く", () => {
    expect(orderedProductSummary(product({ customer_order_no: "PO-9" }))).toBe("PO-9")
    expect(orderedProductSummary(product({}))).toBe("")
  })

  it("複数の注文なら注文の数と直近の希望納期", () => {
    expect(
      orderedProductSummary(
        product({ order_count: 3, order_number: "A-001", nearest_deadline: "2026-12-05" }),
      ),
    ).toBe("3注文・直近の希望納期 2026/12/05")
    expect(orderedProductSummary(product({ order_count: 2 }))).toBe("2注文")
  })
})
