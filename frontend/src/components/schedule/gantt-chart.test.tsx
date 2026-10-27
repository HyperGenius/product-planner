import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, userEvent } from "@/test-utils/render"
import type { Schedule } from "@/types/schedule"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { ProcessShiftResult } from "@/types/schedule-shift"
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

/** ラベル列のラベルと同じ行にあるバー */
function bar(label: string): HTMLElement {
  const row = screen.getByText(label).closest<HTMLElement>('[data-testid="gantt-row-label"]')!.parentElement!
  return row.querySelector<HTMLElement>("[data-task-id]")!
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

  it("工程の状態をバーの外観とバッジで示す", () => {
    renderChart(PROGRESS)

    // 完了: くすんだ色＋✓
    expect(bar("プレス")).toHaveAttribute("data-appearance", "muted")
    expect(bar("プレス")).toHaveTextContent("✓")

    // 進行中で計画の終了を過ぎている: 遅れ（赤の斜線＋！）。進捗の塗りも残る
    expect(bar("カシメ")).toHaveAttribute("data-appearance", "danger")
    expect(bar("カシメ")).toHaveAttribute("data-progress", "40")
    expect(bar("カシメ")).toHaveTextContent("！")

    // 未着手で計画の終了前: 淡い塗り＋枠線、バッジなし
    expect(bar("検査")).toHaveAttribute("data-appearance", "subtle")
    expect(bar("検査")).not.toHaveTextContent(/./)
  })

  it("進行中は進捗率をバッジに出す", () => {
    renderChart([
      progress({
        process_routing_id: 12,
        status: "in_progress",
        good_qty: 60,
        planned_end_datetime: at(12, 16),
      }),
    ])
    expect(bar("カシメ")).toHaveAttribute("data-appearance", "default")
    expect(bar("カシメ")).toHaveTextContent("60%")
  })

  it("進捗の行が無い工程は「計画のみ」で、未着手・遅れに見せない", () => {
    renderChart([PROGRESS[0]])
    expect(bar("カシメ")).toHaveAttribute("data-appearance", "neutral")
    expect(bar("カシメ")).not.toHaveAttribute("data-progress")
    expect(bar("カシメ")).not.toHaveTextContent(/./)
  })

  it("進捗を渡さなければ全工程を「計画のみ」にする", () => {
    renderChart()
    for (const label of ["プレス", "カシメ", "検査"]) {
      expect(bar(label)).toHaveAttribute("data-appearance", "neutral")
      expect(bar(label)).not.toHaveAttribute("data-progress")
    }
  })

  it("ラベル列の工程行に状態のバッジを出す（計画のみは出さない）", () => {
    renderChart([...PROGRESS.slice(0, 2)])
    const badgeOf = (label: string) =>
      screen
        .getByText(label)
        .closest<HTMLElement>('[data-testid="gantt-row-label"]')!
        .querySelector('[data-testid="row-state-badge"]')
    expect(badgeOf("プレス")).toHaveTextContent("完了")
    expect(badgeOf("カシメ")).toHaveTextContent("遅れ")
    expect(badgeOf("検査")).toBeNull()
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
    expect(bar("カシメ")).toHaveAttribute("data-progress", "40")
    expect(bar("カシメ")).toHaveAttribute("data-appearance", "danger")
  })

  it("ツールチップに実績数量・実績日・状態を出す", async () => {
    const user = userEvent.setup()
    renderChart(PROGRESS)

    await user.hover(bar("カシメ"))

    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveTextContent("状態: 進行中（遅れ）")
    expect(tooltip).toHaveTextContent("実績: 40 / 100 (40%)")
    expect(tooltip).toHaveTextContent("実績日: 9/10〜9/11")
    expect(tooltip).toHaveTextContent("計画終了: 9/10 16:00")
  })

  it("後工程の実績から推定した完了はツールチップで分かる", async () => {
    const user = userEvent.setup()
    renderChart(PROGRESS)

    await user.hover(bar("プレス"))

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

  it("バーをタップするとその工程を選ぶ（Issue #581）", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <GanttChart
        tasks={SEGMENTED}
        viewMode="Week"
        groupBy="none"
        currentDate={WEEK}
        nonWorkingDays={WEEKEND}
        onSelect={onSelect}
      />,
    )

    await user.click(segmentBars()[1])
    expect(onSelect).toHaveBeenCalledWith({ kind: "process", orderId: 1, processRoutingId: 31 })
  })
})

describe("GanttChart（スケジュール）の月次表示のセグメント（Issue #537）", () => {
  // 月次の表示範囲は基準日の前3日〜後31日。9/16(水) 基準なら 9/13(日) が1列目
  const MONTH_BASE = new Date(2026, 8, 16)
  const SEGMENTED: Schedule[] = [
    schedule({
      id: 31,
      process_routing_id: 41,
      process_name: "内職",
      equipment_group_name: undefined,
      start_datetime: at(15, 9),
      end_datetime: at(15, 17),
    }),
    schedule({
      id: 32,
      process_routing_id: 41,
      process_name: "内職",
      equipment_group_name: undefined,
      start_datetime: at(17, 9),
      end_datetime: at(17, 17),
    }),
    // 同じ工程名でも別の工程（ルーティング）は別の行
    schedule({
      id: 33,
      process_routing_id: 43,
      process_name: "内職",
      equipment_group_name: undefined,
      start_datetime: at(18, 9),
      end_datetime: at(18, 12),
    }),
  ]

  function renderMonth(groupBy: "none" | "order" | "equipment_group" = "none", onSelect?: () => void) {
    return render(
      <GanttChart
        tasks={SEGMENTED}
        viewMode="Month"
        groupBy={groupBy}
        currentDate={MONTH_BASE}
        onSelect={onSelect}
      />,
    )
  }

  function segmentBars(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-task-id^="schedule-"]'))
  }

  it("セグメントをその日の列に描き、間の日を塗らない", () => {
    renderMonth()
    const bars = segmentBars()
    // 9/15(火) は3列目、9/17(木) は5列目（翌日の列にずれない）
    expect(bars[0].style.gridColumn).toBe("3 / 4")
    expect(bars[1].style.gridColumn).toBe("5 / 6")
  })

  it("同じ工程のセグメントは1行に並べ、別の工程は別の行にする（フラット表示）", () => {
    renderMonth("none")
    const [first, second, other] = segmentBars()
    expect(first.parentElement).toBe(second.parentElement)
    expect(other.parentElement).not.toBe(first.parentElement)
    expect(screen.getAllByText("内職")).toHaveLength(2)
  })

  it("オーダー別でも同じ工程のセグメントを1行に並べる", () => {
    renderMonth("order")
    const [first, second, other] = segmentBars()
    expect(first.parentElement).toBe(second.parentElement)
    expect(other.parentElement).not.toBe(first.parentElement)
  })

  it("設備グループ別は1セグメント1行のまま", () => {
    renderMonth("equipment_group")
    const [first, second] = segmentBars()
    expect(first.parentElement).not.toBe(second.parentElement)
  })

  it("バーをタップするとその工程を選ぶ（Issue #581）", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderMonth("none", onSelect)

    await user.click(segmentBars()[1])
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "process", processRoutingId: 41 }))
  })
})

describe("GanttChart（スケジュール）の注文行・工程行のラベル（Issue #579）", () => {
  const ORDER_A: Partial<Schedule> = {
    order_id: 1,
    order_number: "ORD-1",
    customer_name: "顧客A社",
    product_name: "ピン",
    quantity: 500,
    desired_deadline: "2026-09-30",
    confirmed_deadline: "2026-09-25",
  }
  // 工程順（sequence_order）と開始日時の順が逆になるようにしている
  const ORDERED: Schedule[] = [
    schedule({
      ...ORDER_A,
      id: 1,
      process_routing_id: 11,
      process_name: "カシメ",
      sequence_order: 2,
      equipment_group_name: "カシメG",
      start_datetime: at(10, 9),
      end_datetime: at(10, 12),
    }),
    schedule({
      ...ORDER_A,
      id: 2,
      process_routing_id: 12,
      process_name: "プレス",
      sequence_order: 1,
      equipment_group_name: "ワシノ25t",
      start_datetime: at(10, 13),
      end_datetime: at(10, 16),
    }),
    schedule({
      id: 3,
      order_id: 2,
      order_number: null,
      customer_order_no: null,
      customer_name: null,
      product_name: "ボルト",
      quantity: 1200,
      desired_deadline: null,
      confirmed_deadline: "2026-10-02",
      process_routing_id: 21,
      process_name: "検査",
      sequence_order: 1,
      equipment_group_id: 9,
      equipment_group_name: "検査G",
      start_datetime: at(11, 9),
      end_datetime: at(11, 12),
    }),
  ]

  function renderOrders(groupBy: "order" | "none" | "equipment_group" = "order", tasks = ORDERED) {
    return render(<GanttChart tasks={tasks} viewMode="Day" groupBy={groupBy} currentDate={BASE} />)
  }

  function rowLabels(): string[] {
    return screen.getAllByTestId("gantt-row-label").map((el) => el.textContent ?? "")
  }

  it("注文行に顧客名・製品名と、数量・納期・注文番号を出す", () => {
    renderOrders()
    const [orderA] = rowLabels()
    expect(orderA).toContain("顧客A社")
    expect(orderA).toContain("ピン")
    // 納期は希望納期を優先する
    expect(orderA).toContain("500個 ・ 納期 9/30 ・ ORD-1")
  })

  it("顧客不明は「顧客不明」、希望納期が無ければ完成見込み、注文番号が無ければ内部 ID を出す", () => {
    renderOrders()
    const orderB = rowLabels().find((t) => t.includes("ボルト"))!
    expect(orderB).toContain("顧客不明")
    expect(orderB).toContain("1,200個 ・ 見込 10/2 ・ #2")
  })

  it("オーダー別の工程行は工程順に並べ、工程名と設備（グループ）の表示名を出す", () => {
    renderOrders()
    const labels = rowLabels()
    expect(labels.slice(0, 3)).toEqual([
      expect.stringContaining("顧客A社"),
      "プレスワシノ25t",
      "カシメカシメG",
    ])
  })

  it("注文行は細いサマリーバーで描く", () => {
    renderOrders()
    const summary = document.querySelector<HTMLElement>('[data-task-id="group-order-1"]')!
    expect(summary).toHaveAttribute("data-summary-bar")
  })

  it("フラット・設備グループ別の工程行には、どの注文（顧客・製品）の工程かを出す", () => {
    const { unmount } = renderOrders("none")
    expect(rowLabels()).toContain("顧客A社 ピンプレス")
    expect(rowLabels()).toContain("顧客不明 ボルト検査")
    unmount()

    renderOrders("equipment_group")
    expect(rowLabels()).toContain("検査G")
    expect(rowLabels()).toContain("顧客不明 ボルト検査")
  })

  it("注文行を個別に・まとめて折りたためる", async () => {
    const user = userEvent.setup()
    renderOrders()
    expect(screen.getAllByTestId("gantt-row-label")).toHaveLength(5)

    await user.click(screen.getAllByRole("button", { name: "折りたたむ" })[0])
    expect(screen.queryByText("カシメ")).not.toBeInTheDocument()
    expect(screen.getByText("検査")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展開する" })).toHaveAttribute("aria-expanded", "false")

    await user.click(screen.getByRole("button", { name: "すべて折りたたむ" }))
    expect(screen.getAllByTestId("gantt-row-label")).toHaveLength(2)

    await user.click(screen.getByRole("button", { name: "すべて展開" }))
    expect(screen.getAllByTestId("gantt-row-label")).toHaveLength(5)
  })

  it("フラット表示には折りたたみのボタンを出さない", () => {
    renderOrders("none")
    expect(screen.queryByRole("button", { name: "すべて折りたたむ" })).not.toBeInTheDocument()
  })

  it("表示期間の外へ続く注文・工程は、サマリーバー・工程バーの端に続きの印を出す", () => {
    const continued = [
      schedule({
        ...ORDER_A,
        id: 1,
        process_routing_id: 11,
        process_name: "プレス",
        sequence_order: 1,
        process_start_datetime: at(4, 9),
        process_end_datetime: at(10, 12),
        order_start_datetime: at(4, 9),
        order_end_datetime: at(14, 12),
      }),
      schedule({
        ...ORDER_A,
        id: 2,
        process_routing_id: 12,
        process_name: "カシメ",
        sequence_order: 2,
        start_datetime: at(11, 9),
        end_datetime: at(11, 17),
        process_start_datetime: at(11, 9),
        process_end_datetime: at(14, 12),
        order_start_datetime: at(4, 9),
        order_end_datetime: at(14, 12),
      }),
    ]
    render(<GanttChart tasks={continued} viewMode="Week" groupBy="order" currentDate={BASE} />)

    const summary = document.querySelector<HTMLElement>('[data-task-id="group-order-1"]')!
    expect(summary).toHaveAttribute("data-continues-before", "true")
    expect(summary).toHaveAttribute("data-continues-after", "true")
    // 週次の表示範囲（9/6〜9/12）より前から続くプレス・後へ続くカシメ
    expect(bar("プレス")).toHaveAttribute("data-continues-before", "true")
    expect(bar("プレス")).not.toHaveAttribute("data-continues-after")
    expect(bar("カシメ")).toHaveAttribute("data-continues-after", "true")
    expect(bar("カシメ")).not.toHaveAttribute("data-continues-before")
  })
})

describe("GanttChart（スケジュール）の注文行の状態と納期マーカー（Issue #580）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(2026, 8, 11, 10))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function order(overrides: Partial<Schedule>): Schedule[] {
    const base = {
      order_id: 1,
      customer_name: "顧客A社",
      product_name: "ピン",
      quantity: 100,
      desired_deadline: "2026-09-30",
      confirmed_deadline: null,
    }
    return [
      schedule({ ...base, id: 1, process_routing_id: 11, process_name: "プレス", sequence_order: 1, start_datetime: at(10, 9), end_datetime: at(10, 12), ...overrides }),
      schedule({ ...base, id: 2, process_routing_id: 12, process_name: "検査", sequence_order: 2, start_datetime: at(10, 13), end_datetime: at(10, 16), ...overrides }),
    ]
  }

  function renderOrder(tasks: Schedule[], progressItems?: ProcessProgress[]) {
    return render(
      <GanttChart tasks={tasks} viewMode="Day" groupBy="order" currentDate={BASE} progress={progressItems} />,
    )
  }

  const orderBadge = () => {
    const label = screen.getAllByTestId("gantt-row-label")[0]
    return label.querySelector('[data-testid="row-state-badge"]')
  }

  it("全工程が完了した注文は「完了」", () => {
    renderOrder(order({}), [
      progress({ process_routing_id: 11, sequence_order: 1, status: "completed" }),
      progress({ process_routing_id: 12, sequence_order: 2, status: "completed" }),
    ])
    expect(orderBadge()).toHaveTextContent("完了")
  })

  it("遅れの工程がある注文は「遅れあり」", () => {
    renderOrder(order({}), [
      progress({ process_routing_id: 11, sequence_order: 1, status: "completed" }),
      progress({ process_routing_id: 12, sequence_order: 2, planned_end_datetime: at(10, 16) }),
    ])
    expect(orderBadge()).toHaveTextContent("遅れあり")
  })

  it("それ以外は最終工程の進捗", () => {
    renderOrder(order({}), [
      progress({ process_routing_id: 11, sequence_order: 1, status: "completed" }),
      progress({ process_routing_id: 12, sequence_order: 2, status: "in_progress", good_qty: 50, planned_end_datetime: at(20, 16) }),
    ])
    expect(orderBadge()).toHaveTextContent("進行中 50%")
  })

  it("進捗の行が無い注文には状態を出さない", () => {
    renderOrder(order({}))
    expect(orderBadge()).toBeNull()
  })

  it("納期が表示期間の外なら端に「→ 納期 M/d」を出す", () => {
    renderOrder(order({ desired_deadline: "2026-09-30" }))
    expect(screen.getByTestId("gantt-marker-edge")).toHaveTextContent("→ 納期 9/30")
    expect(screen.queryByTestId("deadline-warning")).not.toBeInTheDocument()
  })

  it("納期が表示期間の中なら縦線を出し、計画が間に合っていれば警告しない", () => {
    renderOrder(order({ desired_deadline: "2026-09-10" }))
    expect(screen.getByTestId("gantt-marker")).toHaveTextContent("納期 9/10")
    expect(screen.queryByTestId("deadline-warning")).not.toBeInTheDocument()
  })

  it("最後の工程の計画終了が希望納期を超える注文には警告を出す", () => {
    renderOrder(order({ desired_deadline: "2026-09-09" }))
    expect(screen.getByTestId("deadline-warning")).toHaveTextContent("納期超過")
  })

  it("完成見込みを納期に使う注文は超過の警告を出さない", () => {
    renderOrder(order({ desired_deadline: null, confirmed_deadline: "2026-09-09" }))
    expect(screen.getByTestId("gantt-marker")).toHaveTextContent("見込 9/9")
    expect(screen.queryByTestId("deadline-warning")).not.toBeInTheDocument()
  })
})

describe("GanttChart（スケジュール）の詳細シートを開くタップと選択中の行（Issue #581）", () => {
  // 注文1: プレス（2区間）・カシメ、注文2: 検査
  const TASKS: Schedule[] = [
    schedule({ id: 1, process_routing_id: 11, process_name: "プレス", sequence_order: 1, equipment_group_id: 1, start_datetime: at(10, 9), end_datetime: at(10, 10) }),
    schedule({ id: 2, process_routing_id: 11, process_name: "プレス", sequence_order: 1, equipment_group_id: 1, start_datetime: at(10, 13), end_datetime: at(10, 14) }),
    schedule({ id: 3, process_routing_id: 12, process_name: "カシメ", sequence_order: 2, equipment_group_id: 2, equipment_group_name: "カシメG", start_datetime: at(11, 9), end_datetime: at(11, 12) }),
    schedule({ id: 4, order_id: 2, customer_name: "顧客B社", product_name: "ボルト", process_routing_id: 21, process_name: "検査", equipment_group_id: 1, start_datetime: at(11, 13), end_datetime: at(11, 15) }),
  ]
  const bar = (id: string) => document.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!
  const selectedLabels = () =>
    screen
      .getAllByTestId("gantt-row-label")
      .filter((label) => label.parentElement?.dataset.selected === "true")
      .map((label) => label.textContent)

  it("注文行のラベル・サマリーバーは注文を、工程行のラベルは工程を選ぶ", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<GanttChart tasks={TASKS} viewMode="Week" groupBy="order" currentDate={BASE} onSelect={onSelect} />)

    await user.click(screen.getByRole("button", { name: /顧客B社/ }))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "order", orderId: 2 })

    await user.click(bar("group-order-1"))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "order", orderId: 1 })

    await user.click(screen.getByRole("button", { name: /カシメ/ }))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "process", orderId: 1, processRoutingId: 12 })
  })

  it("選んだ工程の行をハイライトする。日次は区間ごとの行をすべて塗る", () => {
    const selection = { kind: "process", orderId: 1, processRoutingId: 11 } as const
    const { rerender } = render(
      <GanttChart tasks={TASKS} viewMode="Week" groupBy="order" currentDate={BASE} selection={selection} />,
    )
    expect(selectedLabels()).toEqual(["プレスプレスG"])

    rerender(<GanttChart tasks={TASKS} viewMode="Day" groupBy="order" currentDate={BASE} selection={selection} />)
    expect(selectedLabels()).toEqual(["プレスプレスG", "プレスプレスG"])
  })

  it("選んだ注文は注文行を、注文行の無いフラット表示ではその注文の工程の行を塗る", () => {
    const selection = { kind: "order", orderId: 2 } as const
    const { rerender } = render(
      <GanttChart tasks={TASKS} viewMode="Week" groupBy="order" currentDate={BASE} selection={selection} />,
    )
    expect(selectedLabels()).toHaveLength(1)
    expect(selectedLabels()[0]).toContain("顧客B社")

    rerender(<GanttChart tasks={TASKS} viewMode="Week" groupBy="none" currentDate={BASE} selection={selection} />)
    expect(selectedLabels()).toEqual(["顧客B社 ボルト検査"])
  })

  it("設備グループ行のラベルのタップは折りたたみの切り替え（詳細は開かない）", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onCollapsedGroupIdsChange = vi.fn()
    render(
      <GanttChart
        tasks={TASKS}
        viewMode="Week"
        groupBy="equipment_group"
        currentDate={BASE}
        onSelect={onSelect}
        collapsedGroupIds={new Set()}
        onCollapsedGroupIdsChange={onCollapsedGroupIdsChange}
      />,
    )

    await user.click(screen.getByRole("button", { name: "カシメG" }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(onCollapsedGroupIdsChange).toHaveBeenCalledWith(new Set(["group-equip-2"]))
  })

  it("折りたたみを props で制御できる（画面が localStorage に覚える）", async () => {
    const user = userEvent.setup()
    const onCollapsedGroupIdsChange = vi.fn()
    render(
      <GanttChart
        tasks={TASKS}
        viewMode="Week"
        groupBy="order"
        currentDate={BASE}
        collapsedGroupIds={new Set(["group-order-1"])}
        onCollapsedGroupIdsChange={onCollapsedGroupIdsChange}
      />,
    )
    // 注文1の工程行は隠れている（注文1・注文2・検査）
    expect(screen.getAllByTestId("gantt-row-label")).toHaveLength(3)

    await user.click(screen.getByRole("button", { name: "すべて展開" }))
    expect(onCollapsedGroupIdsChange).toHaveBeenCalledWith(new Set())
  })
})

describe("GanttChart（スケジュール）の前倒し・後ろ倒しのプレビュー（Issue #582）", () => {
  const TASKS: Schedule[] = [
    schedule({ id: 1, process_routing_id: 11, process_name: "プレス", sequence_order: 1, start_datetime: at(10, 9), end_datetime: at(10, 12) }),
    schedule({ id: 2, process_routing_id: 12, process_name: "カシメ", sequence_order: 2, equipment_group_name: "カシメG", start_datetime: at(10, 13), end_datetime: at(10, 16) }),
    schedule({ id: 3, order_id: 2, process_routing_id: 12, process_name: "カシメ", sequence_order: 2, product_name: "ボルト", start_datetime: at(11, 9), end_datetime: at(11, 12) }),
  ]
  const PREVIEW: ProcessShiftResult = {
    order_id: 1,
    process_routing_id: 12,
    working_days: 1,
    stopped_at_previous: false,
    processes: [
      {
        process_routing_id: 12,
        process_name: "カシメ",
        sequence_order: 2,
        is_milestone: false,
        is_completed: false,
        before: { start_datetime: at(10, 13), end_datetime: at(10, 16) },
        after: { start_datetime: at(11, 13), end_datetime: at(14, 10) },
        segments: [
          { start_datetime: at(11, 13), end_datetime: at(11, 17), equipment_id: null },
          { start_datetime: at(14, 9), end_datetime: at(14, 10), equipment_id: null },
        ],
      },
      // 表示中に行の無い後工程にはゴーストバーを出さない
      {
        process_routing_id: 13,
        process_name: "検査",
        sequence_order: 3,
        is_milestone: false,
        is_completed: false,
        before: { start_datetime: at(20, 9), end_datetime: at(20, 10) },
        after: { start_datetime: at(21, 9), end_datetime: at(21, 10) },
        segments: [{ start_datetime: at(21, 9), end_datetime: at(21, 10), equipment_id: null }],
      },
    ],
    confirmed_deadline_before: "2026-09-20",
    confirmed_deadline_after: "2026-09-21",
    desired_deadline: null,
    exceeds_desired_deadline: false,
    overlaps: [],
    saved: false,
  }
  const ghosts = () => Array.from(document.querySelectorAll<HTMLElement>("[data-ghost]"))

  it.each(["Week", "Day"] as const)("%s: 動く工程の元のバーを薄くし、ずらした後のバーを同じ行に重ねる", (viewMode) => {
    render(<GanttChart tasks={TASKS} viewMode={viewMode} groupBy="order" currentDate={BASE} shiftPreview={PREVIEW} />)

    const original = document.querySelector<HTMLElement>('[data-task-id="schedule-2"]')!
    expect(original).toHaveAttribute("data-dimmed", "true")
    expect(ghosts().map((g) => g.dataset.taskId)).toEqual(["shift-preview-12-0", "shift-preview-12-1"])
    ghosts().forEach((g) => expect(g.parentElement).toBe(original.parentElement))
    // 前の工程・他の注文の同じ工程は変わらない
    expect(document.querySelector('[data-task-id="schedule-1"]')).not.toHaveAttribute("data-dimmed")
    expect(document.querySelector('[data-task-id="schedule-3"]')).not.toHaveAttribute("data-dimmed")
  })

  it("プレビューが無ければ重ねない", () => {
    render(<GanttChart tasks={TASKS} viewMode="Week" groupBy="order" currentDate={BASE} shiftPreview={null} />)
    expect(ghosts()).toHaveLength(0)
    expect(document.querySelector("[data-dimmed]")).toBeNull()
  })
})
