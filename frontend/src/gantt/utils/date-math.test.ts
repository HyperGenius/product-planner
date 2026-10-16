import { describe, expect, it } from "vitest"
import {
  buildTimelineConfig,
  getMilestoneGridColumn,
  getTaskGridColumns,
} from "./date-math"

/**
 * 純粋関数のサンプルテスト（Issue #340）。
 * DB もレンダリングも不要なロジックはここに近い粒度で書く。
 */
describe("buildTimelineConfig", () => {
  it("Month モードは1日単位のグリッドを作る", () => {
    const start = new Date("2026-01-01T00:00:00Z")
    const end = new Date("2026-01-11T00:00:00Z")
    const config = buildTimelineConfig(start, end, "Month")

    expect(config.unitDurationMs).toBe(24 * 60 * 60 * 1000)
    expect(config.totalUnits).toBe(10)
    expect(config.slotTimestamps).toBeUndefined()
  })

  it("Day モードは1時間単位で columnWidthPx を持つ", () => {
    const start = new Date("2026-01-01T00:00:00Z")
    const end = new Date("2026-01-01T12:00:00Z")
    const config = buildTimelineConfig(start, end, "Day")

    expect(config.unitDurationMs).toBe(60 * 60 * 1000)
    expect(config.totalUnits).toBe(12)
    expect(config.columnWidthPx).toBe(60)
  })

  it("Week モード + 稼働時間設定で休憩時間を除いた稼働スロットだけを並べる", () => {
    // buildWorkingSlots はローカルタイムで日付を刻むため、端末 TZ の影響を
    // 受けないようローカル深夜の Date で範囲を作る。
    const start = new Date(2026, 0, 5) // 2026-01-05 00:00 local
    const end = new Date(2026, 0, 6) // 2026-01-06 00:00 local
    const config = buildTimelineConfig(start, end, "Week", {
      start: 9,
      end: 18,
      breakStart: 12,
      breakEnd: 13,
    }, [])

    // 9-18時 = 9スロット、うち12時台の休憩1スロットを除いて8。
    expect(config.slotTimestamps).toHaveLength(8)
    expect(config.totalUnits).toBe(8)
  })
})

describe("getTaskGridColumns", () => {
  it("タスクの開始・終了から1始まりの列位置を返す", () => {
    const start = new Date("2026-01-01T00:00:00Z")
    const end = new Date("2026-01-11T00:00:00Z")
    const config = buildTimelineConfig(start, end, "Month")

    const { colStart, colEnd } = getTaskGridColumns(
      new Date("2026-01-03T00:00:00Z"),
      new Date("2026-01-06T00:00:00Z"),
      config,
    )

    expect(colStart).toBe(3)
    expect(colEnd).toBe(6)
  })

  it("範囲外のタスクはグリッド内にクランプする", () => {
    const start = new Date("2026-01-01T00:00:00Z")
    const end = new Date("2026-01-11T00:00:00Z")
    const config = buildTimelineConfig(start, end, "Month")

    const { colStart, colEnd } = getTaskGridColumns(
      new Date("2025-12-20T00:00:00Z"),
      new Date("2026-02-01T00:00:00Z"),
      config,
    )

    expect(colStart).toBe(1)
    expect(colEnd).toBe(config.totalUnits + 1)
  })
})

describe("getTaskGridColumns（均一グリッドの開始列、Issue #537）", () => {
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute)

  it("月次: 日の途中に始まるタスクはその日の列に描く（翌日にずれない）", () => {
    const config = buildTimelineConfig(at(1, 0), at(11, 0), "Month")
    // 1/5 09:00〜17:00 は 5列目の1列だけ
    expect(getTaskGridColumns(at(5, 9), at(5, 17), config)).toEqual({ colStart: 5, colEnd: 6 })
    // 日をまたぐタスク: 1/5 09:00〜1/7 12:00 は 5〜7列目
    expect(getTaskGridColumns(at(5, 9), at(7, 12), config)).toEqual({ colStart: 5, colEnd: 8 })
  })

  it("日次: ○時ちょうどに始まるタスクの列は変わらない", () => {
    const config = buildTimelineConfig(at(5, 0), at(6, 0), "Day")
    expect(getTaskGridColumns(at(5, 9), at(5, 12), config)).toEqual({ colStart: 10, colEnd: 13 })
  })

  it("月次: マイルストーンもその日の列に置く", () => {
    const config = buildTimelineConfig(at(1, 0), at(11, 0), "Month")
    expect(getMilestoneGridColumn(at(5, 9), config)).toBe(5)
  })
})

describe("getTaskGridColumns（稼働時間スロット）", () => {
  // 2026-01-05(月)〜01-07(水)、9〜17時・12時台は休憩 → 1日7スロット
  const WORK_HOURS = { start: 9, end: 17, breakStart: 12, breakEnd: 13 }
  const config = buildTimelineConfig(
    new Date(2026, 0, 5),
    new Date(2026, 0, 8),
    "Week",
    WORK_HOURS,
    [],
  )
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, day, hour, minute)

  it("スロットの開始ちょうどに終わるタスクはそのスロットを塗らない（Issue #535）", () => {
    // 09:00〜10:00 は 09:00 の1列だけ
    expect(getTaskGridColumns(at(5, 9), at(5, 10), config)).toEqual({ colStart: 1, colEnd: 2 })
  })

  it("終業時刻に終わるタスクはその日の最後のスロットまで塗る", () => {
    // 09:00〜17:00 は 1日分の7列（翌日の 09:00 の列は塗らない）
    expect(getTaskGridColumns(at(5, 9), at(5, 17), config)).toEqual({ colStart: 1, colEnd: 8 })
  })

  it("スロットの途中で終わるタスクはそのスロットまで塗る", () => {
    // 翌日 09:00〜09:10 は翌日の 09:00 の1列
    expect(getTaskGridColumns(at(6, 9), at(6, 9, 10), config)).toEqual({ colStart: 8, colEnd: 9 })
  })
})

describe("getMilestoneGridColumn", () => {
  it("所要時間ゼロの工程でも開始列だけを返す（最小幅を作らない）", () => {
    const start = new Date("2026-01-01T00:00:00Z")
    const end = new Date("2026-01-11T00:00:00Z")
    const config = buildTimelineConfig(start, end, "Month")

    expect(
      getMilestoneGridColumn(new Date("2026-01-04T00:00:00Z"), config),
    ).toBe(4)
  })
})
