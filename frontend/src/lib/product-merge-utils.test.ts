import { describe, expect, it } from "vitest"
import type { ProductMergeBlocker, ProductMergeCandidate } from "@/types/product"
import {
  blockerMessage,
  formatOrderCounts,
  mergeIneligibleReason,
  orderStatusLabel,
  selectMergeProductIds,
} from "./product-merge-utils"

/** 重複製品の統合の表示規則 (Issue #515)。品名はダミー値 */

function candidate(overrides: Partial<ProductMergeCandidate>): ProductMergeCandidate {
  return {
    id: 1,
    name: "φ10×20L SUS100",
    code: null,
    is_active: true,
    prefix: "",
    prefix_key: "",
    routing_count: 0,
    timed_routing_count: 0,
    has_decimal_time: false,
    order_counts: {},
    alias_count: 0,
    rank: 0,
    ...overrides,
  }
}

function blocker(overrides: Partial<ProductMergeBlocker>): ProductMergeBlocker {
  return {
    reason: "spec_mismatch",
    product_id: 2,
    product_name: "10φ×20L",
    order_id: null,
    order_number: null,
    order_status: null,
    conflicting_order_id: null,
    conflicting_order_number: null,
    sequence_order: null,
    ...overrides,
  }
}

describe("mergeIneligibleReason", () => {
  const keep = candidate({ id: 1 })

  it("接頭辞が同じ候補は統合できる", () => {
    expect(mergeIneligibleReason(candidate({ id: 2 }), keep)).toBeNull()
  })

  it("接頭辞の有無が違う候補は統合できない", () => {
    expect(
      mergeIneligibleReason(candidate({ id: 2, prefix: "A社", prefix_key: "A社" }), keep)
    ).toMatch(/接頭辞/)
    const prefixedKeep = candidate({ id: 3, prefix: "A社", prefix_key: "A社" })
    expect(mergeIneligibleReason(candidate({ id: 2 }), prefixedKeep)).toMatch(/接頭辞/)
  })

  it("残す製品が未選択・残す製品自身は理由なし", () => {
    expect(mergeIneligibleReason(candidate({ id: 2 }), null)).toBeNull()
    expect(mergeIneligibleReason(keep, keep)).toBeNull()
  })
})

describe("selectMergeProductIds", () => {
  const candidates = [
    candidate({ id: 1 }),
    candidate({ id: 2 }),
    candidate({ id: 3, prefix: "A社", prefix_key: "A社" }),
    candidate({ id: 4 }),
  ]

  it("残す製品・接頭辞違い・チェックを外した候補を除く", () => {
    expect(selectMergeProductIds(candidates, 1, new Set([4]))).toEqual([2])
  })

  it("残す製品が未選択なら空", () => {
    expect(selectMergeProductIds(candidates, null, new Set())).toEqual([])
  })
})

describe("formatOrderCounts", () => {
  it("ステータスの順にラベルを付けて並べる", () => {
    expect(formatOrderCounts({ shipped: 1, confirmed: 2, unknown_status: 1 })).toBe(
      "確定 2 / 送品済み 1 / unknown_status 1"
    )
  })

  it("受注が無ければ null", () => {
    expect(formatOrderCounts({})).toBeNull()
  })
})

describe("orderStatusLabel", () => {
  it("未知の値はそのまま返す", () => {
    expect(orderStatusLabel("in_progress")).toBe("生産中")
    expect(orderStatusLabel("something")).toBe("something")
  })
})

describe("blockerMessage", () => {
  it("受注の衝突は両方の受注を示す", () => {
    expect(
      blockerMessage(
        blocker({
          reason: "order_conflict",
          order_id: 101,
          order_number: "ORD-101",
          order_status: "in_progress",
          conflicting_order_id: 100,
          conflicting_order_number: null,
        })
      )
    ).toBe(
      "同じ顧客・同じ納期の受注が付け替え先にあります: 受注 ORD-101（生産中） と ID 100 が衝突します"
    )
  })

  it("工程の対応が取れない受注と工程の順序を示す", () => {
    expect(
      blockerMessage(
        blocker({ reason: "routing_mismatch", order_id: 101, order_number: "ORD-101", sequence_order: 3 })
      )
    ).toBe("スケジュール済みの工程が残す製品にありません: 受注 ORD-101 の工程 3 番")
  })

  it("仕様・接頭辞の違い", () => {
    expect(blockerMessage(blocker({ reason: "prefix_mismatch" }))).toBe(
      "接頭辞が残す製品と違います"
    )
  })
})
