import { describe, expect, it } from "vitest"
import { toValidStatusFilter } from "./use-orders-page"

describe("toValidStatusFilter（Issue #558）", () => {
  it("?status= が無ければ「すべて」", () => {
    expect(toValidStatusFilter(null)).toBe("")
  })

  it("タブにあるステータスはそのまま使う", () => {
    for (const status of ["", "draft", "pending_approval", "confirmed", "canceled"]) {
      expect(toValidStatusFilter(status)).toBe(status)
    }
  })

  it("廃止した「シミュ済」は「下書き」に寄せる", () => {
    expect(toValidStatusFilter("simulated")).toBe("draft")
  })

  it("廃止した「対応が必要」「情報不足」や未知の値は「すべて」にクランプする", () => {
    for (const raw of ["action_required", "incomplete", "unknown"]) {
      expect(toValidStatusFilter(raw)).toBe("")
    }
  })
})
