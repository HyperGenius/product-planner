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
