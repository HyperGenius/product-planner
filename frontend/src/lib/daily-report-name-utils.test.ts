import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import type { UnmatchedName } from "@/types/daily-report-names"
import {
  formatWorkDate,
  groupProductsByCustomerRaw,
  nameMutationErrorMessage,
  unmatchedNameKey,
} from "./daily-report-name-utils"

describe("unmatchedNameKey", () => {
  it("製品は顧客先との組で区別する（空欄の顧客先も別の行）", () => {
    const base = { kind: "product" as const, raw_text: "短いピン" }
    const keys = new Set([
      unmatchedNameKey({ ...base, customer_raw: "顧客A" }),
      unmatchedNameKey({ ...base, customer_raw: "顧客B" }),
      unmatchedNameKey({ ...base, customer_raw: null }),
    ])
    expect(keys.size).toBe(3)
  })

  it("同じ表記でも種別が違えば別の行", () => {
    expect(unmatchedNameKey({ kind: "process", raw_text: "検査", customer_raw: null })).not.toBe(
      unmatchedNameKey({ kind: "equipment", raw_text: "検査", customer_raw: null }),
    )
  })
})

describe("formatWorkDate", () => {
  it("日付のみの文字列をローカル日付として整形する（TZ で前日にずれない）", () => {
    expect(formatWorkDate("2026-09-01")).toBe("2026/09/01")
  })

  it("null は「－」", () => {
    expect(formatWorkDate(null)).toBe("－")
  })
})

describe("nameMutationErrorMessage", () => {
  const fallback = "失敗しました"

  it("重複（409）はエラーコードで出し分ける", () => {
    expect(
      nameMutationErrorMessage(
        new ApiError(409, { detail: { error: "duplicate_alias", message: "x" } }),
        fallback,
      ),
    ).toContain("既に対応付けてあります")
    expect(
      nameMutationErrorMessage(
        new ApiError(409, { detail: { error: "duplicate_ignored_name", message: "x" } }),
        fallback,
      ),
    ).toBe("この表記は既に対象外です")
  })

  it("422 は API の文言をそのまま出す", () => {
    expect(
      nameMutationErrorMessage(
        new ApiError(422, { detail: "マスタに無い工程名です: 仕上げ" }),
        fallback,
      ),
    ).toBe("マスタに無い工程名です: 仕上げ")
  })

  it("422 でも detail が文字列でなければ（Pydantic の検証エラー）固定文言", () => {
    expect(
      nameMutationErrorMessage(new ApiError(422, { detail: [{ msg: "x" }] }), fallback),
    ).toBe(fallback)
  })

  it("403 は操作できるロールを案内する", () => {
    expect(nameMutationErrorMessage(new ApiError(403, { detail: "x" }), fallback)).toContain(
      "受注担当",
    )
  })

  it("その他は固定文言", () => {
    expect(nameMutationErrorMessage(new Error("boom"), fallback)).toBe(fallback)
  })
})

describe("groupProductsByCustomerRaw（Issue #703）", () => {
  function name(overrides: Partial<UnmatchedName>): UnmatchedName {
    return {
      kind: "product",
      raw_text: "ピンA",
      customer_raw: null,
      customer_id: null,
      entry_count: 1,
      last_work_date: "2026-11-01",
      ...overrides,
    }
  }
  const customer = (raw: string, entryCount = 1) =>
    name({ kind: "customer", raw_text: raw, entry_count: entryCount })

  it("未登録の顧客先ごとに、その顧客先の製品をまとめる（顧客先・製品とも受け取った順）", () => {
    const groups = groupProductsByCustomerRaw(
      [customer("顧客X", 20), customer("顧客Y", 5)],
      [
        name({ raw_text: "ピン1", customer_raw: "顧客Y" }),
        name({ raw_text: "ピン2", customer_raw: "顧客X" }),
        name({ raw_text: "ピン3", customer_raw: "顧客Y" }),
      ],
    )
    expect(
      groups.unregistered.map((g) => [g.customerRaw, g.products.map((p) => p.raw_text)]),
    ).toEqual([
      ["顧客X", ["ピン2"]],
      ["顧客Y", ["ピン1", "ピン3"]],
    ])
    expect(groups.unresolved).toEqual([])
  })

  it("製品の行が無い顧客先もまとまりとして出す", () => {
    const groups = groupProductsByCustomerRaw([customer("顧客X")], [])
    expect(groups.unregistered).toHaveLength(1)
    expect(groups.unregistered[0].customer.raw_text).toBe("顧客X")
    expect(groups.unregistered[0].products).toEqual([])
  })

  it("顧客先が空欄の製品・未登録の一覧に無い（対象外にした）顧客先の製品は、顧客を選べないまとまりにする", () => {
    const groups = groupProductsByCustomerRaw(
      [customer("顧客X")],
      [
        name({ raw_text: "ピン1", customer_raw: null }),
        name({ raw_text: "ピン2", customer_raw: "社内" }),
        name({ raw_text: "ピン3", customer_raw: "顧客X" }),
        name({ raw_text: "ピン4", customer_raw: "社内" }),
        name({ raw_text: "ピン5", customer_raw: null }),
      ],
    )
    expect(groups.unregistered.map((g) => g.products.map((p) => p.raw_text))).toEqual([["ピン3"]])
    // 対象外にした顧客先 → 空欄の順
    expect(
      groups.unresolved.map((g) => [g.type, g.customerRaw, g.products.map((p) => p.raw_text)]),
    ).toEqual([
      ["ignored", "社内", ["ピン2", "ピン4"]],
      ["blank", null, ["ピン1", "ピン5"]],
    ])
  })

  it("どの製品もどれか1つのまとまりにだけ入る", () => {
    const products = [
      name({ raw_text: "ピン1", customer_raw: "顧客X" }),
      name({ raw_text: "ピン1", customer_raw: null }),
      name({ raw_text: "ピン1", customer_raw: "社内" }),
    ]
    const groups = groupProductsByCustomerRaw([customer("顧客X")], products)
    const placed = [...groups.unregistered, ...groups.unresolved].flatMap((g) => g.products)
    expect(placed.map(unmatchedNameKey).sort()).toEqual(products.map(unmatchedNameKey).sort())
  })
})
