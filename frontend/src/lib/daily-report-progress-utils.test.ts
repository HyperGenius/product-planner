import { describe, expect, it } from "vitest"
import type { ProcessProgress } from "@/types/daily-report-progress"
import {
  formatActualDateRange,
  formatProgressQuantity,
  indexProgress,
  isProgressDelayed,
  orderStateLabelText,
  processDisplayState,
  processStateBadge,
  processStateLabelText,
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

describe("processDisplayState（Issue #580）", () => {
  const now = new Date(2026, 8, 11, 10)
  const past = new Date(2026, 8, 10, 16).toISOString()
  const future = new Date(2026, 8, 12, 16).toISOString()

  it("進捗の行が無ければ計画のみ（未着手・遅れにしない）", () => {
    expect(processDisplayState(undefined, now)).toBe("planned_only")
  })

  it("完了は計画の終了を過ぎていても完了", () => {
    expect(processDisplayState(progress({ status: "completed", planned_end_datetime: past }), now)).toBe("completed")
  })

  it("計画の終了を過ぎて未完了なら、未着手・進行中でも遅れ", () => {
    expect(processDisplayState(progress({ planned_end_datetime: past }), now)).toBe("delayed")
    expect(processDisplayState(progress({ status: "in_progress", planned_end_datetime: past }), now)).toBe("delayed")
  })

  it("計画の終了前なら未着手・進行中", () => {
    expect(processDisplayState(progress({ planned_end_datetime: future }), now)).toBe("not_started")
    expect(processDisplayState(progress({ status: "in_progress", planned_end_datetime: future }), now)).toBe("in_progress")
  })

  it("計画の終了が無い（未スケジュール）未完了は遅れにしない", () => {
    expect(processDisplayState(progress({ planned_end_datetime: null }), now)).toBe("not_started")
  })
})

describe("processStateBadge / processStateLabelText（Issue #580）", () => {
  const inProgress = progress({ status: "in_progress", good_qty: 60 })

  it("バーのバッジ: 完了 ✓ / 遅れ ！ / 進行中は進捗率 / 未着手・計画のみは無し", () => {
    expect(processStateBadge("completed", progress({ status: "completed" }))).toBe("✓")
    expect(processStateBadge("delayed", inProgress)).toBe("！")
    expect(processStateBadge("in_progress", inProgress)).toBe("60%")
    expect(processStateBadge("not_started", progress())).toBeNull()
    expect(processStateBadge("planned_only", undefined)).toBeNull()
  })

  it("受注数量が不明な進行中は進捗率を出さない", () => {
    expect(processStateBadge("in_progress", progress({ status: "in_progress", order_quantity: null }))).toBeNull()
  })

  it("ラベル列のバッジ文言", () => {
    expect(processStateLabelText("completed", progress({ status: "completed" }))).toBe("完了")
    expect(processStateLabelText("in_progress", inProgress)).toBe("進行中 60%")
    expect(processStateLabelText("in_progress", progress({ status: "in_progress", order_quantity: null }))).toBe("進行中")
    expect(processStateLabelText("delayed", inProgress)).toBe("遅れ")
    expect(processStateLabelText("not_started", progress())).toBe("未着手")
    expect(processStateLabelText("planned_only", undefined)).toBeNull()
  })
})

describe("orderStateLabelText（Issue #580）", () => {
  const now = new Date(2026, 8, 11, 10)
  const past = new Date(2026, 8, 10, 16).toISOString()
  const future = new Date(2026, 8, 12, 16).toISOString()

  it("進捗の行が無い注文は null", () => {
    expect(orderStateLabelText([], now)).toBeNull()
  })

  it("全工程完了なら完了", () => {
    const done = [1, 2].map((n) => progress({ sequence_order: n, status: "completed" }))
    expect(orderStateLabelText(done, now)).toEqual({ state: "completed", text: "完了" })
  })

  it("遅れの工程があれば遅れあり", () => {
    const items = [
      progress({ sequence_order: 1, planned_end_datetime: past }),
      progress({ sequence_order: 2, planned_end_datetime: future }),
    ]
    expect(orderStateLabelText(items, now)).toEqual({ state: "delayed_some", text: "遅れあり" })
  })

  it("それ以外は最終工程（sequence_order 最大）の進捗", () => {
    const items = [
      progress({ sequence_order: 2, status: "in_progress", good_qty: 30, planned_end_datetime: future }),
      progress({ sequence_order: 1, status: "completed" }),
    ]
    expect(orderStateLabelText(items, now)).toEqual({ state: "in_progress", text: "進行中 30%" })
  })
})
