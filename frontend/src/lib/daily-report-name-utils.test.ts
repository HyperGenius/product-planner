import { describe, expect, it } from "vitest"
import { ApiError } from "@/lib/api-client"
import {
  formatWorkDate,
  nameMutationErrorMessage,
  productAliasBlockedReason,
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

describe("productAliasBlockedReason", () => {
  it("顧客先が照合できていれば登録できる", () => {
    expect(productAliasBlockedReason({ customer_raw: "顧客A", customer_id: 1 })).toBeNull()
  })

  it("顧客先が未照合なら先に顧客の対応付けを促す", () => {
    expect(productAliasBlockedReason({ customer_raw: "顧客A", customer_id: null })).toBe(
      "顧客先「顧客A」を先に「顧客」で対応付けてください",
    )
  })

  it("顧客先が空欄なら登録できない", () => {
    expect(productAliasBlockedReason({ customer_raw: null, customer_id: null })).toContain(
      "顧客先が空欄",
    )
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
    ).toContain("既に登録されています")
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
