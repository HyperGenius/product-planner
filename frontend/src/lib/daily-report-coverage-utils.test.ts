import { describe, expect, it } from "vitest"
import type { UnallocatedGroup } from "@/types/daily-report-progress"
import {
  allocatedRatio,
  formatPercent,
  matchesCategoryFilter,
  productLabel,
  productsWithoutRoutings,
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
    ...overrides,
  }
}

describe("productsWithoutRoutings", () => {
  it("工程ルートが無い製品の no_routing_process を製品ごとに集め、数量の多い順に並べる", () => {
    const groups = [
      group({ product_id: 2, category: "no_routing_process", reason: "no_routing_process", product_has_routings: false, process_name: "溶接", qty: 50, row_count: 3 }),
      group({ product_id: 3, category: "no_routing_process", reason: "no_routing_process", product_has_routings: false, process_name: "プレス", qty: 40 }),
      group({ product_id: 2, category: "no_routing_process", reason: "no_routing_process", product_has_routings: false, process_name: "プレス", qty: 30, row_count: 2 }),
      // 工程ルートはあるが、その工程が無い製品は含めない
      group({ product_id: 4, category: "no_routing_process", reason: "no_routing_process", product_has_routings: true, qty: 999 }),
      group({ product_id: 5, qty: 999 }),
    ]

    const result = productsWithoutRoutings(groups)

    expect(result.map((p) => [p.product_id, p.qty, p.row_count, p.process_names])).toEqual([
      [2, 80, 5, ["溶接", "プレス"]],
      [3, 40, 1, ["プレス"]],
    ])
  })
})

describe("matchesCategoryFilter", () => {
  it("要確認は出荷済みの受注のみの実績を除く", () => {
    expect(matchesCategoryFilter(group({ category: "no_order" }), "hearing")).toBe(true)
    expect(matchesCategoryFilter(group({ category: "closed_order_only" }), "hearing")).toBe(false)
    expect(matchesCategoryFilter(group({ category: "closed_order_only" }), "all")).toBe(true)
    expect(matchesCategoryFilter(group({ category: "closed_order_only" }), "closed_order_only")).toBe(true)
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
