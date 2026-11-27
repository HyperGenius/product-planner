import { describe, expect, it } from "vitest"
import type { UnallocatedGroup } from "@/types/daily-report-progress"
import {
  allocatedRatio,
  formatPercent,
  matchesCategoryFilter,
  productLabel,
} from "./daily-report-coverage-utils"

function group(overrides: Partial<UnallocatedGroup>): UnallocatedGroup {
  return {
    product_id: 1,
    product_name: "テスト製品A",
    product_code: null,
    product_has_routings: true,
    process_name: "プレス",
    reason: "no_candidate_order",
    category: "no_order",
    row_count: 1,
    qty: 10,
    first_work_date: "2026-09-01",
    last_work_date: "2026-09-01",
    customer_names: [],
    other_customer_orders: [],
    ...overrides,
  }
}

describe("matchesCategoryFilter", () => {
  it("要確認は出荷済みの受注のみの実績を除く", () => {
    expect(matchesCategoryFilter(group({ category: "no_order" }), "hearing")).toBe(true)
    expect(matchesCategoryFilter(group({ category: "closed_order_only" }), "hearing")).toBe(false)
    expect(matchesCategoryFilter(group({ category: "closed_order_only" }), "all")).toBe(true)
    expect(
      matchesCategoryFilter(group({ category: "closed_order_only" }), "closed_order_only"),
    ).toBe(true)
    expect(matchesCategoryFilter(group({ category: "no_order" }), "before_order_date")).toBe(false)
  })

  it("要確認は作り置き（#591）とみなした受注日より前の実績を除く", () => {
    expect(matchesCategoryFilter(group({ category: "before_order_date" }), "hearing")).toBe(true)
    expect(matchesCategoryFilter(group({ category: "stocked" }), "hearing")).toBe(false)
    expect(matchesCategoryFilter(group({ category: "stocked" }), "stocked")).toBe(true)
  })
})

describe("allocatedRatio / formatPercent", () => {
  const summary = {
    total_qty: 200,
    allocated_qty: 150,
    unallocated_qty: 30,
    unmatched_rows: 2,
    unmatched_qty: 20,
    unallocated: [],
  }

  it("割り付けできた割合を数量で求める", () => {
    expect(formatPercent(allocatedRatio(summary))).toBe("75%")
  })

  it("実績が無ければ － を出す", () => {
    expect(formatPercent(allocatedRatio({ ...summary, total_qty: 0, allocated_qty: 0 }))).toBe("－")
  })
})

describe("productLabel", () => {
  it("図番があれば添え、品名が無ければ製品 ID を出す", () => {
    expect(productLabel(group({ product_code: "P-001" }))).toBe("テスト製品A（P-001）")
    expect(productLabel(group({ product_id: 9, product_name: null }))).toBe("製品 #9")
  })
})
