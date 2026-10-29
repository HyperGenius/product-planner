import { describe, expect, it } from "vitest"
import { DEFAULT_SCHEDULE_VIEW_PREFS, MAX_COLLAPSED_GROUP_IDS, parseScheduleViewPrefs } from "./schedule-view-prefs"

describe("parseScheduleViewPrefs", () => {
  it("既知の値はそのまま使う", () => {
    const prefs = {
      viewMode: "Month",
      groupBy: "none",
      equipmentGroupId: 3,
      customer: { customerId: 5, label: "A社" },
      collapsedGroupIds: ["group-order-1"],
      legendOpen: false,
    }
    expect(parseScheduleViewPrefs(prefs)).toEqual(prefs)
  })

  it("外れた項目だけ既定値に戻す", () => {
    expect(
      parseScheduleViewPrefs({ viewMode: "Year", groupBy: "order", equipmentGroupId: "3", collapsedGroupIds: [1, "g"] }),
    ).toEqual({ ...DEFAULT_SCHEDULE_VIEW_PREFS, groupBy: "order", collapsedGroupIds: ["g"] })
  })

  it("凡例の開閉が保存されていない（#589 より前の保存値）・不正なら開いた状態にする", () => {
    expect(parseScheduleViewPrefs({ viewMode: "Week" })!.legendOpen).toBe(true)
    expect(parseScheduleViewPrefs({ legendOpen: "false" })!.legendOpen).toBe(true)
  })

  it("顧客の絞り込み: 顧客不明（customerId が null）も覚え、形が崩れていれば「すべて」に戻す", () => {
    expect(parseScheduleViewPrefs({ customer: { customerId: null, label: "顧客不明" } })!.customer).toEqual({
      customerId: null,
      label: "顧客不明",
    })
    expect(parseScheduleViewPrefs({ viewMode: "Week" })!.customer).toBeNull()
    expect(parseScheduleViewPrefs({ customer: { customerId: "5", label: "A社" } })!.customer).toBeNull()
    expect(parseScheduleViewPrefs({ customer: { customerId: 1.5, label: "A社" } })!.customer).toBeNull()
    expect(parseScheduleViewPrefs({ customer: { customerId: 5, label: "" } })!.customer).toBeNull()
    expect(parseScheduleViewPrefs({ customer: { customerId: 5 } })!.customer).toBeNull()
  })

  it("オブジェクトでなければ null（既定値を使う）", () => {
    expect(parseScheduleViewPrefs("Week")).toBeNull()
    expect(parseScheduleViewPrefs(null)).toBeNull()
  })

  it("折りたたみは新しいものから上限まで", () => {
    const ids = Array.from({ length: MAX_COLLAPSED_GROUP_IDS + 5 }, (_, i) => `g${i}`)
    const parsed = parseScheduleViewPrefs({ collapsedGroupIds: ids })!
    expect(parsed.collapsedGroupIds).toHaveLength(MAX_COLLAPSED_GROUP_IDS)
    expect(parsed.collapsedGroupIds[0]).toBe("g5")
  })
})
