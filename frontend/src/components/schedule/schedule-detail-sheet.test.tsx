import { describe, expect, it, vi } from "vitest"
import { render, screen, userEvent } from "@/test-utils/render"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { Schedule } from "@/types/schedule"
import { buildOrderDetail, buildProcessDetail } from "@/lib/schedule-detail-utils"
import { ScheduleDetailSheet } from "./schedule-detail-sheet"

const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString()
const NOW = new Date(2026, 8, 12, 12)

const ORDER: Partial<Schedule> = {
  order_id: 1,
  order_number: "ORD-1",
  customer_order_no: "PO-9",
  customer_name: "顧客A社",
  product_name: "ピン",
  quantity: 500,
  desired_deadline: "2026-09-30",
  confirmed_deadline: "2026-09-25",
  order_status: "in_progress",
}
const SCHEDULES: Schedule[] = [
  { ...ORDER, id: 1, order_id: 1, process_routing_id: 11, equipment_id: null, process_name: "プレス", sequence_order: 1, equipment_group_name: "プレスG", start_datetime: at(10, 9), end_datetime: at(10, 12) },
  { ...ORDER, id: 2, order_id: 1, process_routing_id: 11, equipment_id: null, process_name: "プレス", sequence_order: 1, equipment_group_name: "プレスG", start_datetime: at(11, 9), end_datetime: at(11, 12) },
  { ...ORDER, id: 3, order_id: 1, process_routing_id: 12, equipment_id: null, process_name: "カシメ", sequence_order: 2, start_datetime: at(12, 9), end_datetime: at(12, 10) },
]
const PROGRESS: ProcessProgress[] = [
  {
    order_id: 1,
    process_routing_id: 11,
    sequence_order: 1,
    process_name: "プレス",
    good_qty: 500,
    order_quantity: 500,
    first_actual_date: "2026-09-10",
    last_actual_date: "2026-09-11",
    status: "completed",
    completed_by: "later_process",
    planned_end_datetime: at(11, 12),
  },
]

function renderProcess(canEdit: boolean, handlers: { onSelect?: () => void; onEditSegment?: () => void } = {}) {
  return render(
    <ScheduleDetailSheet
      detail={buildProcessDetail(SCHEDULES, PROGRESS, 1, 11, NOW)!}
      now={NOW}
      canEdit={canEdit}
      onClose={vi.fn()}
      onSelect={handlers.onSelect ?? vi.fn()}
      onEditSegment={handlers.onEditSegment ?? vi.fn()}
    />,
  )
}

describe("ScheduleDetailSheet（Issue #581）", () => {
  it("工程: 注文・工程・実績の項目をすべて出す", () => {
    renderProcess(false)
    const sheet = screen.getByRole("complementary", { name: "工程の詳細" })
    for (const text of [
      "顧客A社",
      "ピン",
      "500個",
      "2026/9/30",
      "2026/9/25",
      "ORD-1",
      "PO-9",
      "生産中",
      "プレスG",
      "9/10 09:00 - 9/11 12:00（2区間）",
      "500 / 500",
      "9/10〜9/11",
      "後工程に実績がある（推定）",
    ]) {
      expect(sheet).toHaveTextContent(text)
    }
    expect(screen.getByRole("link", { name: /受注詳細を開く/ })).toHaveAttribute("href", "/orders/1")
  })

  it("編集できないロールには「操作」を出さない", () => {
    renderProcess(false)
    expect(screen.queryByText("操作")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /編集/ })).not.toBeInTheDocument()
  })

  it("編集できるロールは区間ごとに開始・終了の編集を開ける", async () => {
    const user = userEvent.setup()
    const onEditSegment = vi.fn()
    renderProcess(true, { onEditSegment })
    const buttons = screen.getAllByRole("button", { name: /開始・終了を編集/ })
    expect(buttons).toHaveLength(2)
    await user.click(buttons[1])
    expect(onEditSegment).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it("工程から注文の全工程へ移れる", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderProcess(false, { onSelect })
    await user.click(screen.getByRole("button", { name: /この注文の全工程を見る/ }))
    expect(onSelect).toHaveBeenCalledWith({ kind: "order", orderId: 1 })
  })

  it("注文: 全工程の一覧と状態を出し、工程をタップするとその工程へ移る", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ScheduleDetailSheet
        detail={buildOrderDetail(SCHEDULES, PROGRESS, 1, NOW)!}
        now={NOW}
        canEdit
        onClose={vi.fn()}
        onSelect={onSelect}
        onEditSegment={vi.fn()}
      />,
    )
    const sheet = screen.getByRole("complementary", { name: "注文の詳細" })
    expect(sheet).toHaveTextContent("顧客A社 ピン")
    const press = screen.getByRole("button", { name: /プレス/ })
    expect(press).toHaveTextContent("完了")
    await user.click(screen.getByRole("button", { name: /カシメ/ }))
    expect(onSelect).toHaveBeenCalledWith({ kind: "process", orderId: 1, processRoutingId: 12 })
  })
})
