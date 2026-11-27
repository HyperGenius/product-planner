import { describe, expect, it } from "vitest"
import { CATEGORY_ORDER, unallocatedGroupKey } from "@/lib/daily-report-coverage-utils"
import { unmatchedNameKey } from "@/lib/daily-report-name-utils"
import type { DailyReportCoverage, UnallocatedGroup } from "@/types/daily-report-progress"
import type { UnmatchedName } from "@/types/daily-report-names"
import {
  DAILY_REPORT_HUB_HREF,
  UNALLOCATED_CATEGORY_PLACEMENT,
  classifyDailyReportWorklist,
  countStockProducts,
  dailyReportHrefFromLegacyCoverageHash,
  groupProcessProducts,
  placeUnmatchedName,
  type DailyReportWorklist,
} from "./daily-report-worklist-utils"

/** 日報の実績のハブの振り分け（Issue #707）。表記・製品はダミー値 */

function name(overrides: Partial<UnmatchedName>): UnmatchedName {
  return {
    kind: "product",
    raw_text: "ピンA",
    customer_raw: "顧客A",
    customer_id: 1,
    entry_count: 1,
    last_work_date: "2026-11-01",
    ...overrides,
  }
}

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
    first_work_date: "2026-11-01",
    last_work_date: "2026-11-01",
    customer_names: [],
    other_customer_orders: [],
    ...overrides,
  }
}

function coverage(groups: UnallocatedGroup[]): DailyReportCoverage {
  return {
    computed_at: "2026-11-25T00:15:00Z",
    since: "2026-09-01",
    summary: {
      total_qty: 100,
      allocated_qty: 60,
      unallocated_qty: 30,
      unmatched_rows: 2,
      unmatched_qty: 10,
      unallocated: [],
    },
    groups,
  }
}

/** 振り分けた先（前提・①②③・対象外）を、表記・まとめのキーの一覧にする */
function placedKeys(worklist: DailyReportWorklist): string[] {
  return [
    ...worklist.prerequisite.customers.map(unmatchedNameKey),
    ...worklist.prerequisite.products.map(unmatchedNameKey),
    ...worklist.products.map(unmatchedNameKey),
    ...worklist.processes.names.map(unmatchedNameKey),
    ...worklist.excluded.names.map(unmatchedNameKey),
    ...worklist.processes.products.flatMap((row) => row.groups.map(unallocatedGroupKey)),
    ...worklist.unordered.map(unallocatedGroupKey),
  ]
}

/** どの表記・まとめも、どこか1か所にだけ置かれている（送品の消し込みの `expectEachPlacedOnce()` と同じ考え方） */
function expectEachPlacedOnce(
  names: readonly UnmatchedName[],
  groups: readonly UnallocatedGroup[],
  worklist: DailyReportWorklist,
) {
  const expected = [...names.map(unmatchedNameKey), ...groups.map(unallocatedGroupKey)]
  expect(placedKeys(worklist).sort()).toEqual([...expected].sort())
}

const NAMES: UnmatchedName[] = [
  name({ kind: "customer", raw_text: "顧客X", customer_raw: null, customer_id: null }),
  name({ kind: "customer", raw_text: "顧客Y", customer_raw: null, customer_id: null }),
  // 顧客先が決まっていない製品（未登録・空欄）は前提
  name({ raw_text: "ピンX", customer_raw: "顧客X", customer_id: null }),
  name({ raw_text: "ピンZ", customer_raw: null, customer_id: null }),
  // 顧客先が決まっている製品は①
  name({ raw_text: "ピンA", customer_raw: "顧客A", customer_id: 1 }),
  name({ raw_text: "ピンA", customer_raw: "顧客B", customer_id: 2 }),
  name({ raw_text: "ピンB", customer_raw: "顧客A", customer_id: 1 }),
  // 工程は②、設備は対象外
  name({ kind: "process", raw_text: "ﾌﾟﾚｽ加工", customer_raw: null, customer_id: null }),
  name({ kind: "equipment", raw_text: "200t 1号機", customer_raw: null, customer_id: null }),
]

const GROUPS: UnallocatedGroup[] = [
  // 工程ルートが無い製品（2工程）
  group({
    product_id: 2,
    product_has_routings: false,
    category: "no_routing_process",
    reason: "no_routing_process",
    process_name: "溶接",
    qty: 50,
  }),
  group({
    product_id: 2,
    product_has_routings: false,
    category: "no_routing_process",
    reason: "no_routing_process",
    process_name: "プレス",
    qty: 30,
  }),
  // 工程ルートに無い工程・日報で追わない工程の実績
  group({ product_id: 3, category: "no_routing_process", reason: "no_routing_process", qty: 40 }),
  group({
    product_id: 3,
    category: "untracked_process",
    reason: "untracked_process",
    process_name: "検査",
    qty: 5,
  }),
  // それ以外は③
  group({ product_id: 4, category: "no_order", qty: 20 }),
  group({ product_id: 4, category: "before_order_date", reason: "before_order_date", qty: 15 }),
  group({ product_id: 5, category: "closed_order_only", qty: 8 }),
  group({ product_id: 6, category: "stocked", reason: "before_order_date", qty: 3 }),
]

describe("placeUnmatchedName", () => {
  it("顧客先は前提、顧客先が決まった製品は①・決まっていない製品は前提、工程は②、設備は対象外", () => {
    expect(placeUnmatchedName({ kind: "customer", customer_id: null })).toBe("prerequisite")
    expect(placeUnmatchedName({ kind: "product", customer_id: 1 })).toBe("products")
    expect(placeUnmatchedName({ kind: "product", customer_id: null })).toBe("prerequisite")
    expect(placeUnmatchedName({ kind: "process", customer_id: null })).toBe("processes")
    expect(placeUnmatchedName({ kind: "equipment", customer_id: null })).toBe("excluded")
  })
})

describe("UNALLOCATED_CATEGORY_PLACEMENT", () => {
  it("工程に関する未割当だけを②に置き、ほかは今の分類のまま③に置く", () => {
    const processes = CATEGORY_ORDER.filter((c) => UNALLOCATED_CATEGORY_PLACEMENT[c] === "processes")
    expect(processes.sort()).toEqual(["no_routing_process", "untracked_process"])
  })
})

describe("classifyDailyReportWorklist", () => {
  it("どの表記・まとめも、前提・①②③・対象外のどこか1か所にだけ置く", () => {
    const worklist = classifyDailyReportWorklist({
      unmatchedNames: NAMES,
      coverage: coverage(GROUPS),
    })
    expectEachPlacedOnce(NAMES, GROUPS, worklist)
  })

  it("件数は各ページの行の数（前提は顧客先と製品を分けて数え、②は製品の数）", () => {
    const worklist = classifyDailyReportWorklist({
      unmatchedNames: NAMES,
      coverage: coverage(GROUPS),
    })
    expect(worklist.counts).toEqual({
      customer: 2,
      prerequisiteProduct: 2,
      products: 3,
      processNames: 1,
      processProducts: 2,
      unordered: 4,
    })
    expect(worklist.counts.products).toBe(worklist.products.length)
    expect(worklist.counts.processProducts).toBe(worklist.processes.products.length)
    expect(worklist.counts.unordered).toBe(worklist.unordered.length)
    expect(worklist.products.map((n) => [n.raw_text, n.customer_raw])).toEqual([
      ["ピンA", "顧客A"],
      ["ピンA", "顧客B"],
      ["ピンB", "顧客A"],
    ])
    expect(worklist.excluded.names.map((n) => n.raw_text)).toEqual(["200t 1号機"])
  })

  it("届いていないデータの件数は null（途中の件数を出さない）", () => {
    expect(classifyDailyReportWorklist({ unmatchedNames: NAMES }).counts).toEqual({
      customer: 2,
      prerequisiteProduct: 2,
      products: 3,
      processNames: 1,
      processProducts: null,
      unordered: null,
    })
    expect(classifyDailyReportWorklist({ coverage: coverage(GROUPS) }).counts).toMatchObject({
      customer: null,
      products: null,
      processProducts: 2,
      unordered: 4,
    })
  })

  it("何も無ければ件数は0", () => {
    expect(
      classifyDailyReportWorklist({ unmatchedNames: [], coverage: coverage([]) }).counts,
    ).toEqual({
      customer: 0,
      prerequisiteProduct: 0,
      products: 0,
      processNames: 0,
      processProducts: 0,
      unordered: 0,
    })
  })
})

describe("groupProcessProducts", () => {
  it("工程に関する未割当を製品ごとに集め、数量の多い順に並べる", () => {
    const rows = groupProcessProducts(
      GROUPS.filter((g) => UNALLOCATED_CATEGORY_PLACEMENT[g.category] === "processes"),
    )
    expect(
      rows.map((r) => [r.product_id, r.product_has_routings, r.qty, r.process_names, r.groups.length]),
    ).toEqual([
      [2, false, 80, ["溶接", "プレス"], 2],
      [3, true, 45, ["プレス", "検査"], 2],
    ])
  })
})

describe("countStockProducts", () => {
  it("同じ製品の複数の工程の推定は1製品と数える", () => {
    const item = (product_id: number, process_name: string) => ({
      product_id,
      product_name: null,
      product_code: null,
      process_name,
      next_process_name: null,
      qty: 1,
      last_movement_date: null,
    })
    expect(countStockProducts({ items: [item(1, "プレス"), item(1, "溶接"), item(2, "プレス")] })).toBe(2)
  })
})

describe("dailyReportHrefFromLegacyCoverageHash", () => {
  it("旧照合状況のカードのハッシュを対応するページへ、それ以外はハブへ移す", () => {
    expect(dailyReportHrefFromLegacyCoverageHash("#unallocated")).toBe(
      "/master/daily-reports/unordered",
    )
    expect(dailyReportHrefFromLegacyCoverageHash("#routing")).toBe(
      "/master/daily-reports/processes",
    )
    expect(dailyReportHrefFromLegacyCoverageHash("#stock")).toBe("/master/daily-reports/stock")
    expect(dailyReportHrefFromLegacyCoverageHash("#unmatched")).toBe(DAILY_REPORT_HUB_HREF)
    expect(dailyReportHrefFromLegacyCoverageHash("")).toBe(DAILY_REPORT_HUB_HREF)
    expect(dailyReportHrefFromLegacyCoverageHash("#javascript:alert(1)")).toBe(
      DAILY_REPORT_HUB_HREF,
    )
  })
})
