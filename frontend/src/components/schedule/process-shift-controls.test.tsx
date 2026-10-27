import { describe, expect, it, vi } from "vitest"
import { render, screen, userEvent } from "@/test-utils/render"
import { ApiError } from "@/lib/api-client"
import type { ProcessShiftResult } from "@/types/schedule-shift"
import { formatShiftAmount, ProcessShiftControls, type ProcessShiftControlsProps } from "./process-shift-controls"

const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString()

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
      before: { start_datetime: at(10, 13), end_datetime: at(11, 12) },
      after: { start_datetime: at(11, 13), end_datetime: at(14, 12) },
      segments: [],
    },
    {
      process_routing_id: 13,
      process_name: "検査",
      sequence_order: 3,
      is_milestone: false,
      is_completed: false,
      before: { start_datetime: at(14, 9), end_datetime: at(14, 10) },
      after: { start_datetime: at(15, 9), end_datetime: at(15, 10) },
      segments: [],
    },
  ],
  confirmed_deadline_before: "2026-09-14",
  confirmed_deadline_after: "2026-09-15",
  desired_deadline: "2026-09-14",
  exceeds_desired_deadline: false,
  overlaps: [],
  saved: false,
}

function renderControls(props: Partial<ProcessShiftControlsProps> = {}) {
  const handlers = { onChange: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn() }
  render(
    <ProcessShiftControls
      workingDays={1}
      preview={PREVIEW}
      isPreviewLoading={false}
      previewError={null}
      isSaving={false}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe("formatShiftAmount", () => {
  it("符号付きの稼働日", () => {
    expect(formatShiftAmount(2)).toBe("+2日")
    expect(formatShiftAmount(-1)).toBe("−1日")
    expect(formatShiftAmount(0)).toBe("±0日")
  })
})

describe("ProcessShiftControls（Issue #582）", () => {
  it("ボタン1回で1稼働日ずつ量を増減する", async () => {
    const user = userEvent.setup()
    const { onChange } = renderControls({ workingDays: 2 })
    expect(screen.getByText("+2日")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /後ろ倒し/ }))
    expect(onChange).toHaveBeenLastCalledWith(3)
    await user.click(screen.getByRole("button", { name: /前倒し/ }))
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it("動く工程の前後の期間と新しい完成見込みを出し、確定・取り消しできる", async () => {
    const user = userEvent.setup()
    const { onConfirm, onCancel } = renderControls()
    const list = screen.getByRole("list", { name: "ずらした後の計画" })
    expect(list).toHaveTextContent("カシメ")
    expect(list).toHaveTextContent("9/11 13:00 - 9/14 12:00")
    expect(list).toHaveTextContent("検査")
    expect(screen.getByText("完成見込み").nextElementSibling).toHaveTextContent("9/14 (月) → 9/15 (火)")

    await user.click(screen.getByRole("button", { name: "確定" }))
    expect(onConfirm).toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "取り消し" }))
    expect(onCancel).toHaveBeenCalled()
  })

  it("ずらす量が 0 ならプレビュー・確定を出さない", () => {
    renderControls({ workingDays: 0, preview: undefined })
    expect(screen.getByText("±0日")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "確定" })).not.toBeInTheDocument()
  })

  it("前工程で止まったら警告を出し、それ以上前倒しさせない", () => {
    renderControls({ workingDays: -2, preview: { ...PREVIEW, working_days: -2, stopped_at_previous: true } })
    expect(screen.getByText(/前の工程の終了で止まりました/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /前倒し/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /後ろ倒し/ })).toBeEnabled()
  })

  it("希望納期の超過・完了済みの工程・同じ設備の重なりを警告する（確定はできる）", () => {
    renderControls({
      preview: {
        ...PREVIEW,
        exceeds_desired_deadline: true,
        processes: [{ ...PREVIEW.processes[0], is_completed: true }, PREVIEW.processes[1]],
        overlaps: [
          {
            process_routing_id: 12,
            process_name: "カシメ",
            equipment_id: 5,
            equipment_name: "カシメ機1",
            other_order_id: 9,
            other_order_number: "ORD-9",
            other_process_name: "カシメ",
            start_datetime: at(11, 14),
            end_datetime: at(11, 15),
          },
        ],
      },
    })
    expect(screen.getByText(/希望納期（9\/14 \(月\)）を超えます/)).toBeInTheDocument()
    expect(screen.getByText(/日報で完了済みの工程も動きます（カシメ）/)).toBeInTheDocument()
    expect(screen.getByText(/同じ設備の他の注文と重なります/).parentElement).toHaveTextContent(
      "カシメ機1: ORD-9（カシメ） 9/11 14:00 - 15:00",
    )
    expect(screen.getByRole("button", { name: "確定" })).toBeEnabled()
  })

  it("計算中・保存中は確定できない", () => {
    renderControls({ preview: undefined, isPreviewLoading: true })
    expect(screen.getByText("計算中...")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "確定" })).toBeDisabled()
  })

  it("プレビューの失敗は固定文言で出す", () => {
    renderControls({
      preview: undefined,
      previewError: new ApiError(409, { detail: { error: "order_not_adjustable", message: "x" } }),
    })
    expect(screen.getByText("確定済み・生産中の注文だけ計画をずらせます")).toBeInTheDocument()
  })
})
