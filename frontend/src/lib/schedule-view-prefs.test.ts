import { describe, expect, it } from "vitest"
import { DEFAULT_SCHEDULE_VIEW_PREFS, MAX_COLLAPSED_GROUP_IDS, parseScheduleViewPrefs } from "./schedule-view-prefs"

describe("parseScheduleViewPrefs", () => {
  it("既知の値はそのまま使う", () => {
    const prefs = { viewMode: "Month", groupBy: "none", equipmentGroupId: 3, collapsedGroupIds: ["group-order-1"] }
    expect(parseScheduleViewPrefs(prefs)).toEqual(prefs)
  })

  it("外れた項目だけ既定値に戻す", () => {
    expect(
      parseScheduleViewPrefs({ viewMode: "Year", groupBy: "order", equipmentGroupId: "3", collapsedGroupIds: [1, "g"] }),
    ).toEqual({ ...DEFAULT_SCHEDULE_VIEW_PREFS, groupBy: "order", collapsedGroupIds: ["g"] })
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
