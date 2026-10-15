import { describe, expect, it } from "vitest"
import {
  isSplitDeadlineMissing,
  isSplitProductMissing,
  isSplitQuantityInvalid,
  validateSplitItems,
} from "./split-order-validation"
import type { SplitLineItemInput } from "./split-order-validation"

function makeItem(overrides: Partial<SplitLineItemInput> = {}): SplitLineItemInput {
  return {
    productId: "1",
    quantity: "10",
    desiredDeadline: "2026-12-01",
    ...overrides,
  }
}

describe("validateSplitItems", () => {
  it("明細が2件以上かつすべて入力済みなら ok になる", () => {
    const result = validateSplitItems([makeItem(), makeItem()])
    expect(result.ok).toBe(true)
    expect(result.message).toBe("")
  })

  it("明細が2件未満なら不可", () => {
    const result = validateSplitItems([makeItem()])
    expect(result.ok).toBe(false)
    expect(result.message).toBe("分割後の明細は2件以上入力してください")
  })

  it("製品未選択の明細があれば不可", () => {
    const result = validateSplitItems([makeItem(), makeItem({ productId: "" })])
    expect(result.ok).toBe(false)
    expect(result.message).toBe("すべての明細で製品を選択してください")
  })

  it.each(["", "abc", "0", "-1"])(
    "数量が不正 (%s) な明細があれば不可",
    (quantity) => {
      const result = validateSplitItems([makeItem(), makeItem({ quantity })])
      expect(result.ok).toBe(false)
      expect(result.message).toBe("すべての明細で数量を正しく入力してください")
    }
  )

  it("希望納期未入力の明細があれば不可", () => {
    const result = validateSplitItems([makeItem(), makeItem({ desiredDeadline: "" })])
    expect(result.ok).toBe(false)
    expect(result.message).toBe("すべての明細で希望納期を入力してください")
  })
})

describe("フィールド単位の判定関数", () => {
  it("isSplitProductMissing は未選択・非数値のときに true", () => {
    expect(isSplitProductMissing(makeItem({ productId: "" }))).toBe(true)
    expect(isSplitProductMissing(makeItem({ productId: "abc" }))).toBe(true)
    expect(isSplitProductMissing(makeItem({ productId: "1" }))).toBe(false)
  })

  it("isSplitQuantityInvalid は未入力・0以下・非数値のときに true", () => {
    expect(isSplitQuantityInvalid(makeItem({ quantity: "" }))).toBe(true)
    expect(isSplitQuantityInvalid(makeItem({ quantity: "0" }))).toBe(true)
    expect(isSplitQuantityInvalid(makeItem({ quantity: "abc" }))).toBe(true)
    expect(isSplitQuantityInvalid(makeItem({ quantity: "5" }))).toBe(false)
  })

  it("isSplitDeadlineMissing は未入力のときに true", () => {
    expect(isSplitDeadlineMissing(makeItem({ desiredDeadline: "" }))).toBe(true)
    expect(isSplitDeadlineMissing(makeItem({ desiredDeadline: "2026-12-01" }))).toBe(false)
  })
})
