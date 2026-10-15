import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, userEvent } from "@/test-utils/render"
import type { Schedule } from "@/types/schedule"
import type { ProcessProgress } from "@/types/daily-report-progress"
import { GanttChart } from "./gantt-chart"

// 表示の基準日（端末 TZ 非依存にローカル時刻で作る）
const BASE = new Date(2026, 8, 10)
const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString()

function schedule(overrides: Partial<Schedule> & Pick<Schedule, "id" | "process_routing_id">): Schedule {
  return {
    order_id: 1,
    equipment_id: null,
    start_datetime: at(10, 9),
    end_datetime: at(10, 12),
    order_number: "ORD-1",
    product_name: "ピン",
    equipment_group_name: "プレスG",
    ...overrides,
  }
}

const SCHEDULES: Schedule[] = [
  schedule({ id: 1, process_routing_id: 11, process_name: "プレス" }),
  schedule({
    id: 2,
    process_routing_id: 12,
    process_name: "カシメ",
    equipment_group_name: "カシメG",
    start_datetime: at(10, 13),
    end_datetime: at(10, 16),
  }),
  schedule({
    id: 3,
    process_routing_id: 13,
    process_name: "検査",
    equipment_group_name: "検査G",
    start_datetime: at(11, 9),
    end_datetime: at(11, 12),
  }),
]

function progress(overrides: Partial<ProcessProgress> & Pick<ProcessProgress, "process_routing_id">): ProcessProgress {
  return {
    order_id: 1,
    sequence_order: 1,
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

const PROGRESS: ProcessProgress[] = [
  progress({
    process_routing_id: 11,
    status: "completed",
    completed_by: "later_process",
    good_qty: 0,
    planned_end_datetime: at(10, 12),
  }),
  progress({
    process_routing_id: 12,
    status: "in_progress",
    good_qty: 40,
    first_actual_date: "2026-09-10",
    last_actual_date: "2026-09-11",
    // 計画の終了は「今」（9/11 10:00）より前 → 遅れ
    planned_end_datetime: at(10, 16),
  }),
  // 検査（routing 13）は計画の終了が「今」より後の未着手
  progress({ process_routing_id: 13, planned_end_datetime: at(11, 12) }),
]

function bar(label: string): HTMLElement {
  return screen.getByText(label).parentElement!
}

describe("GanttChart（スケジュール）の進捗表示", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 8, 11, 10))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderChart(progressItems?: ProcessProgress[]) {
    return render(
      <GanttChart
        tasks={SCHEDULES}
        viewMode="Day"
        groupBy="none"
        currentDate={BASE}
        progress={progressItems}
      />,
    )
  }

  it("進捗率を塗りで示し、計画の終了を過ぎて未完了の工程を遅れにする", () => {
    renderChart(PROGRESS)

    expect(bar("プレス - プレスG")).toHaveAttribute("data-progress", "100")
    expect(bar("プレス - プレスG")).not.toHaveAttribute("data-delayed")

    expect(bar("カシメ - カシメG")).toHaveAttribute("data-progress", "40")
    expect(bar("カシメ - カシメG")).toHaveAttribute("data-delayed", "true")

    // 未着手は塗らない。計画の終了前なので遅れでもない（現状どおり）
    expect(bar("検査 - 検査G")).not.toHaveAttribute("data-progress")
    expect(bar("検査 - 検査G")).not.toHaveAttribute("data-delayed")
  })

  it("進捗の行が無い工程・進捗を渡さないときは現状どおりの表示", () => {
    renderChart([PROGRESS[0]])
    expect(bar("カシメ - カシメG")).not.toHaveAttribute("data-progress")
    expect(bar("カシメ - カシメG")).not.toHaveAttribute("data-delayed")
  })

  it("進捗を渡さなければ塗り・遅れを出さない", () => {
    renderChart()
    for (const label of ["プレス - プレスG", "カシメ - カシメG", "検査 - 検査G"]) {
      expect(bar(label)).not.toHaveAttribute("data-progress")
      expect(bar(label)).not.toHaveAttribute("data-delayed")
    }
  })

  it("週次でセグメントを1行に並べたバーにも進捗を載せる", () => {
    render(
      <GanttChart
        tasks={SCHEDULES}
        viewMode="Week"
        groupBy="none"
        currentDate={BASE}
        progress={PROGRESS}
      />,
    )
    expect(bar("カシメ - カシメG")).toHaveAttribute("data-progress", "40")
    expect(bar("カシメ - カシメG")).toHaveAttribute("data-delayed", "true")
  })

  it("ツールチップに実績数量・実績日・状態を出す", async () => {
    const user = userEvent.setup()
    renderChart(PROGRESS)

    await user.hover(bar("カシメ - カシメG"))

    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveTextContent("状態: 進行中（遅れ）")
    expect(tooltip).toHaveTextContent("実績: 40 / 100 (40%)")
    expect(tooltip).toHaveTextContent("実績日: 9/10〜9/11")
    expect(tooltip).toHaveTextContent("計画終了: 9/10 16:00")
  })

  it("後工程の実績から推定した完了はツールチップで分かる", async () => {
    const user = userEvent.setup()
    renderChart(PROGRESS)

    await user.hover(bar("プレス - プレスG"))

    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveTextContent("状態: 完了（後工程の実績から推定）")
  })
})

describe("GanttChart（スケジュール）の週次表示のセグメント（Issue #535）", () => {
  // 2026-09-13(日)〜09-19(土) の週（ja ロケールは日曜始まり）。月曜と木曜に同じ工程のセグメントがある
  const WEEK = new Date(2026, 8, 16)
  const WEEKEND = [new Date(2026, 8, 13), new Date(2026, 8, 19)]
  const SEGMENTED: Schedule[] = [
    schedule({
      id: 21,
      process_routing_id: 31,
      process_name: "内職",
      equipment_group_name: undefined,
      start_datetime: at(14, 9),
      end_datetime: at(14, 17),
    }),
    schedule({
      id: 22,
      process_routing_id: 31,
      process_name: "内職",
      equipment_group_name: undefined,
      start_datetime: new Date(2026, 8, 17, 13, 30).toISOString(),
      end_datetime: at(17, 17),
    }),
    // 同じ工程名でも別の工程（ルーティング）は別の行
    schedule({
      id: 23,
      process_routing_id: 33,
      process_name: "内職",
      equipment_group_name: undefined,
      start_datetime: at(18, 9),
      end_datetime: at(18, 12),
    }),
  ]

  function renderWeek() {
    return render(
      <GanttChart
        tasks={SEGMENTED}
        viewMode="Week"
        groupBy="none"
        currentDate={WEEK}
        nonWorkingDays={WEEKEND}
      />,
    )
  }

  function segmentBars(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-task-id^="schedule-"]'))
  }

  it("セグメントごとにバーを描き、間の空き時間を塗らない", () => {
    renderWeek()
    const bars = segmentBars()
    expect(bars.map((b) => b.dataset.taskId)).toEqual(["schedule-21", "schedule-22", "schedule-23"])

    // 1日7スロット（9〜17時、12時台は休憩）。月曜 09:00〜17:00 は 1〜7列、
    // 木曜 13:30〜17:00 は 14:00〜16:00 のスロット（木曜は 22列目から）
    expect(bars[0].style.gridColumn).toBe("1 / 8")
    expect(bars[1].style.gridColumn).toBe("26 / 29")
  })

  it("同じ工程のセグメントは1行に並べ、別の工程は同じ工程名でも別の行にする", () => {
    renderWeek()
    const [first, second, other] = segmentBars()
    expect(first.parentElement).toBe(second.parentElement)
    expect(other.parentElement).not.toBe(first.parentElement)
    // ラベルは行の最後のセグメントにだけ出す
    expect(screen.getAllByText("内職")).toHaveLength(2)
  })

  it("ツールチップにセグメントの日付と工程全体の範囲を出す", async () => {
    const user = userEvent.setup()
    renderWeek()

    await user.hover(segmentBars()[0])

    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveTextContent("9/14 09:00 - 17:00")
    expect(tooltip).toHaveTextContent("この工程（表示中）: 9/14 09:00 - 9/17 17:00（2区間）")
  })

  it("クリックするとそのセグメントを渡す", async () => {
    const user = userEvent.setup()
    const onTaskClick = vi.fn()
    render(
      <GanttChart
        tasks={SEGMENTED}
        viewMode="Week"
        groupBy="none"
        currentDate={WEEK}
        nonWorkingDays={WEEKEND}
        onTaskClick={onTaskClick}
      />,
    )

    await user.click(segmentBars()[1])
    expect(onTaskClick).toHaveBeenCalledWith(expect.objectContaining({ id: 22 }))
  })
})
