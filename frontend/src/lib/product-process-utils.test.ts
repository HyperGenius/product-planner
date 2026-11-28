import { describe, expect, it } from "vitest"
import {
  allInRouting,
  parsePeriodParam,
  parseProductIdParam,
  productProcessHref,
} from "./product-process-utils"

/** ② 製品の工程の比較の URL・揃ったかの判定（Issue #708） */

describe("productProcessHref / parsePeriodParam", () => {
  it("既定の期間は付けず、すべては all にする（往復で同じ期間に戻る）", () => {
    expect(productProcessHref(5, 3)).toBe("/master/daily-reports/processes/5")
    expect(productProcessHref(5, null)).toBe("/master/daily-reports/processes/5?months=all")
    expect(productProcessHref(5, 12)).toBe("/master/daily-reports/processes/5?months=12")
    for (const months of [1, 3, 6, 12, null]) {
      const query = new URL(productProcessHref(5, months), "http://localhost").searchParams
      expect(parsePeriodParam(query.get("months"))).toBe(months)
    }
  })

  it("選べる期間に無い値は既定の期間にする", () => {
    expect(parsePeriodParam("2")).toBe(3)
    expect(parsePeriodParam("abc")).toBe(3)
    expect(parsePeriodParam("")).toBe(3)
  })
})

describe("parseProductIdParam", () => {
  it("1以上の整数だけを受け取る", () => {
    expect(parseProductIdParam("12")).toBe(12)
    for (const value of ["0", "-1", "1.5", "abc", "", undefined, ["1"], "99999999999999999999"]) {
      expect(parseProductIdParam(value)).toBeNull()
    }
  })
})

describe("allInRouting", () => {
  it("工程名がすべて工程ルートにあるときだけ揃ったとみなす（前後の空白は無視）", () => {
    expect(allInRouting(["プレス"], [" プレス ", "溶接"])).toBe(true)
    expect(allInRouting(["プレス", "研磨"], ["プレス", "溶接"])).toBe(false)
    expect(allInRouting([], ["プレス"])).toBe(false)
  })
})
