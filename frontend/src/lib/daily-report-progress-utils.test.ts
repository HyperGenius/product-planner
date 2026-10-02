import { describe, expect, it } from "vitest"
import type { ProcessProgress } from "@/types/daily-report-progress"
import {
  formatActualDateRange,
  formatProgressQuantity,
  indexProgress,
  isProgressDelayed,
  progressKey,
  progressRatio,
  progressStatusLabel,
} from "./daily-report-progress-utils"

function progress(overrides: Partial<ProcessProgress> = {}): ProcessProgress {
  return {
    order_id: 1,
    process_routing_id: 11,
    sequence_order: 1,
    process_name: "プレス",
    good_qty: 0,
    order_quantity: 100,
    first_actual_date: null,
    last_actual_date: null,
    status: "not_started",
    completed_by: null,
    planned_end_datetime: null,
    ...overrides,
  }
}

describe("progressRatio", () => {
  it("良品数 ÷ 受注数量", () => {
    expect(progressRatio(progress({ status: "in_progress", good_qty: 25 }))).toBe(0.25)
  })

  it("完了は良品数に関わらず 100%（後工程の実績から推定した完了も含む）", () => {
    expect(
      progressRatio(progress({ status: "completed", completed_by: "later_process", good_qty: 0 })),
    ).toBe(1)
  })

  it("100% を上限にする", () => {
    expect(progressRatio(progress({ status: "in_progress", good_qty: 150 }))).toBe(1)
  })

  it("未着手・受注数量が不明なら塗らない（null）", () => {
    expect(progressRatio(progress())).toBeNull()
    expect(
      progressRatio(progress({ status: "in_progress", good_qty: 5, order_quantity: null })),
    ).toBeNull()
    expect(
      progressRatio(progress({ status: "in_progress", good_qty: 5, order_quantity: 0 })),
    ).toBeNull()
  })
})

describe("isProgressDelayed", () => {
  const plannedEnd = "2026-09-11T08:00:00Z" // JST 17:00
  const before = new Date("2026-09-11T07:59:59Z")
  const after = new Date("2026-09-11T08:00:01Z")

  it("計画の終了日時を過ぎて完了していない工程は遅れ（未着手も含む）", () => {
    expect(
      isProgressDelayed(progress({ status: "in_progress", planned_end_datetime: plannedEnd }), after),
    ).toBe(true)
    expect(isProgressDelayed(progress({ planned_end_datetime: plannedEnd }), after)).toBe(true)
  })

  it("計画の終了日時より前は遅れにしない", () => {
    expect(
      isProgressDelayed(progress({ status: "in_progress", planned_end_datetime: plannedEnd }), before),
    ).toBe(false)
  })

  it("完了・計画の終了日時が無い工程は遅れにしない", () => {
    expect(
      isProgressDelayed(progress({ status: "completed", planned_end_datetime: plannedEnd }), after),
    ).toBe(false)
    expect(isProgressDelayed(progress({ status: "in_progress" }), after)).toBe(false)
  })
})

describe("progressStatusLabel", () => {
  it("状態のラベル。後工程の実績による完了は推定であることを示す", () => {
    expect(progressStatusLabel(progress())).toBe("未着手")
    expect(progressStatusLabel(progress({ status: "in_progress" }))).toBe("進行中")
    expect(
      progressStatusLabel(progress({ status: "completed", completed_by: "quantity" })),
    ).toBe("完了")
    expect(
      progressStatusLabel(progress({ status: "completed", completed_by: "later_process" })),
    ).toBe("完了（後工程の実績から推定）")
  })
})

describe("formatProgressQuantity", () => {
  it("良品数 / 受注数量。受注数量が不明なら良品数のみ", () => {
    expect(formatProgressQuantity(progress({ good_qty: 1200, order_quantity: 3000 }))).toBe(
      "1,200 / 3,000",
    )
    expect(formatProgressQuantity(progress({ good_qty: 5, order_quantity: null }))).toBe("5")
  })
})

describe("formatActualDateRange", () => {
  it("初回〜最終の実績日（端末のタイムゾーンで日付がずれない）", () => {
    expect(
      formatActualDateRange(
        progress({ first_actual_date: "2026-09-10", last_actual_date: "2026-09-12" }),
      ),
    ).toBe("9/10〜9/12")
  })

  it("同じ日・片方だけなら1日分", () => {
    expect(
      formatActualDateRange(
        progress({ first_actual_date: "2026-09-10", last_actual_date: "2026-09-10" }),
      ),
    ).toBe("9/10")
    expect(formatActualDateRange(progress({ last_actual_date: "2026-09-12" }))).toBe("9/12")
  })

  it("実績が無ければ null", () => {
    expect(formatActualDateRange(progress())).toBeNull()
  })
})

describe("indexProgress", () => {
  it("(受注, 工程) で引ける", () => {
    const a = progress({ order_id: 1, process_routing_id: 11 })
    const b = progress({ order_id: 2, process_routing_id: 11 })
    const index = indexProgress([a, b])
    expect(index.get(progressKey(2, 11))).toBe(b)
    expect(index.get(progressKey(1, 12))).toBeUndefined()
    expect(indexProgress(undefined).size).toBe(0)
  })
})
