import { describe, expect, it } from "vitest"
import { getDaysRemaining, getDeadlineStatus } from "./floor-dashboard-utils"

/**
 * `getDeadlineStatus` / `getDaysRemaining` のユニットテスト（Issue #442）。
 * 現場ダッシュボードの顧客別受注情報バッジと検索・フィルタの凡例（#444）が共有する
 * 純粋関数のため、閾値の境界値を重点的に検証する。
 */
describe("getDeadlineStatus", () => {
  const todayIso = "2026-09-10"

  it("納期未設定なら null", () => {
    expect(getDeadlineStatus(undefined, todayIso)).toBeNull()
  })

  it("納期が本日より前なら overdue", () => {
    expect(getDeadlineStatus("2026-09-09", todayIso)).toBe("overdue")
  })

  it("納期が本日なら due_soon（1週間未満の境界内）", () => {
    expect(getDeadlineStatus("2026-09-10", todayIso)).toBe("due_soon")
  })

  it("納期が6日後なら due_soon", () => {
    expect(getDeadlineStatus("2026-09-16", todayIso)).toBe("due_soon")
  })

  it("納期が7日後なら on_track（1週間以上）", () => {
    expect(getDeadlineStatus("2026-09-17", todayIso)).toBe("on_track")
  })

  it("月をまたぐ境界でも正しく判定する", () => {
    // 2026-09-24 は today=2026-09-27 の3日後 → due_soon
    expect(getDeadlineStatus("2026-09-27", "2026-09-24")).toBe("due_soon")
    // 2026-10-01 は today=2026-09-24 の7日後 → on_track
    expect(getDeadlineStatus("2026-10-01", "2026-09-24")).toBe("on_track")
  })
})

describe("getDaysRemaining", () => {
  it("本日なら0", () => {
    expect(getDaysRemaining("2026-09-10", "2026-09-10")).toBe(0)
  })

  it("超過なら負の値", () => {
    expect(getDaysRemaining("2026-09-08", "2026-09-10")).toBe(-2)
  })

  it("未来なら正の値（月またぎでも正しい）", () => {
    expect(getDaysRemaining("2026-10-02", "2026-09-30")).toBe(2)
  })
})
