import { describe, expect, it } from "vitest"
import {
  formatDeadlineForFloorDashboard,
  getDaysRemaining,
  getDeadlineStatus,
  matchesSearchText,
} from "./floor-dashboard-utils"

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

describe("formatDeadlineForFloorDashboard", () => {
  it("当年は MM/DD", () => {
    expect(formatDeadlineForFloorDashboard("2026-09-08", "2026-09-10")).toBe("09/08")
  })

  it("翌年以降は YYYY/MM/DD", () => {
    expect(formatDeadlineForFloorDashboard("2027-01-05", "2026-09-10")).toBe("2027/01/05")
  })

  it("未設定なら null", () => {
    expect(formatDeadlineForFloorDashboard(undefined, "2026-09-10")).toBeNull()
  })
})

/**
 * `matchesSearchText` のユニットテスト（Issue #444）。
 * 顧客別受注情報（#442）・出荷予定表（#443）の両エリアで共有する検索マッチング関数。
 */
describe("matchesSearchText", () => {
  const fields = {
    customerName: "顧客A",
    productPrimary: "P-001",
    productSecondary: "製品A",
    orderNumber: "O-100",
  }

  it("検索語が空なら常にtrue", () => {
    expect(matchesSearchText("", fields)).toBe(true)
    expect(matchesSearchText("   ", fields)).toBe(true)
  })

  it("顧客名に部分一致すればtrue", () => {
    expect(matchesSearchText("顧客A", fields)).toBe(true)
  })

  it("製品名（primary/secondary）に部分一致すればtrue", () => {
    expect(matchesSearchText("P-001", fields)).toBe(true)
    expect(matchesSearchText("製品A", fields)).toBe(true)
  })

  it("注文番号に部分一致すればtrue", () => {
    expect(matchesSearchText("O-100", fields)).toBe(true)
  })

  it("大文字小文字を区別しない", () => {
    expect(matchesSearchText("o-100", fields)).toBe(true)
  })

  it("いずれにも一致しなければfalse", () => {
    expect(matchesSearchText("該当なし", fields)).toBe(false)
  })

  it("フィールドがnullでもエラーにならない", () => {
    expect(
      matchesSearchText("該当なし", {
        customerName: null,
        productPrimary: null,
        productSecondary: null,
        orderNumber: null,
      }),
    ).toBe(false)
  })
})
