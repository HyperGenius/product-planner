import { describe, expect, it } from "vitest"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { Schedule } from "@/types/schedule"
import { buildOrderDetail, buildProcessDetail, buildScheduleDetail, formatRange } from "./schedule-detail-utils"

const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString()
const NOW = new Date(2026, 8, 12, 12)

function schedule(overrides: Partial<Schedule> & Pick<Schedule, "id" | "process_routing_id">): Schedule {
  return {
    order_id: 1,
    equipment_id: null,
    start_datetime: at(10, 9),
    end_datetime: at(10, 12),
    product_name: "ピン",
    ...overrides,
  }
}

function progress(overrides: Partial<ProcessProgress> & Pick<ProcessProgress, "process_routing_id">): ProcessProgress {
  return {
    order_id: 1,
    sequence_order: null,
    process_name: null,
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

const SCHEDULES: Schedule[] = [
  schedule({ id: 2, process_routing_id: 11, process_name: "プレス", sequence_order: 1, equipment_group_name: "プレスG", start_datetime: at(11, 9), end_datetime: at(11, 12) }),
  schedule({ id: 1, process_routing_id: 11, process_name: "プレス", sequence_order: 1, equipment_group_name: "プレスG", start_datetime: at(10, 9), end_datetime: at(10, 12), process_start_datetime: at(9, 9), process_end_datetime: at(11, 12) }),
  schedule({ id: 3, process_routing_id: 12, process_name: "カシメ", sequence_order: 2, equipment_group_name: "カシメG", start_datetime: at(12, 9), end_datetime: at(12, 10) }),
  schedule({ id: 4, order_id: 2, process_routing_id: 21, process_name: "検査" }),
]

describe("buildProcessDetail", () => {
  it("表示中のセグメント（開始順）・範囲・工程全体の範囲・進捗の状態をまとめる", () => {
    const detail = buildProcessDetail(
      SCHEDULES,
      [progress({ process_routing_id: 11, status: "in_progress", good_qty: 40 })],
      1,
      11,
      NOW,
    )!
    expect(detail.segments.map((s) => s.id)).toEqual([1, 2])
    expect(detail.processName).toBe("プレス")
    expect(detail.equipmentGroupNames).toEqual(["プレスG"])
    expect(formatRange(detail.visibleRange.start, detail.visibleRange.end)).toBe("9/10 09:00 - 9/11 12:00")
    // 工程全体は先頭セグメントの process_start/end_datetime（表示期間外を含む）
    expect(detail.processRange.start).toEqual(new Date(at(9, 9)))
    expect(detail.state).toBe("in_progress")
  })

  it("進捗の行が無い工程は「計画のみ」、表示中に無い工程は null", () => {
    expect(buildProcessDetail(SCHEDULES, [], 1, 12, NOW)?.state).toBe("planned_only")
    expect(buildProcessDetail(SCHEDULES, [], 1, 99, NOW)).toBeNull()
  })
})

describe("buildOrderDetail", () => {
  it("表示中の工程と進捗のある工程を合わせ、工程順に並べる", () => {
    const detail = buildOrderDetail(
      SCHEDULES,
      [
        progress({ process_routing_id: 12, status: "completed", completed_by: "quantity" }),
        // 表示期間に計画が無い最終工程
        progress({ process_routing_id: 13, sequence_order: 3, process_name: "梱包" }),
        progress({ order_id: 2, process_routing_id: 21 }),
      ],
      1,
      NOW,
    )!
    expect(detail.processes.map((p) => [p.processName, p.segmentCount, p.state])).toEqual([
      ["プレス", 2, "planned_only"],
      ["カシメ", 1, "completed"],
      ["梱包", 0, "not_started"],
    ])
    expect(detail.processes[2].visibleRange).toBeNull()
    // 注文の状態の判定には、その注文の進捗だけを使う
    expect(detail.progressItems).toHaveLength(2)
  })

  it("表示期間に1つもセグメントが無い注文は null", () => {
    expect(buildOrderDetail(SCHEDULES, [], 3, NOW)).toBeNull()
  })
})

describe("buildScheduleDetail", () => {
  it("選択が無い・スケジュール未取得なら null", () => {
    expect(buildScheduleDetail(null, SCHEDULES, [], NOW)).toBeNull()
    expect(buildScheduleDetail({ kind: "order", orderId: 1 }, undefined, [], NOW)).toBeNull()
    expect(buildScheduleDetail({ kind: "order", orderId: 1 }, SCHEDULES, [], NOW)?.kind).toBe("order")
  })
})
