import { describe, expect, it } from "vitest"
import userEvent from "@testing-library/user-event"
import { render, screen } from "@/test-utils/render"
import type { BulkSimulateResult } from "@/types/order"
import { BulkSimulateSummaryDialog } from "./bulk-simulate-summary-dialog"

function makeResults(count: number, feasible = true): BulkSimulateResult[] {
  return Array.from({ length: count }, (_, i) => ({
    orderId: i + 1,
    orderNo: `O-${i + 1}`,
    result: {
      is_feasible: feasible,
      calculated_deadline: "2026-10-05T09:00:00",
    } as BulkSimulateResult["result"],
  }))
}

describe("BulkSimulateSummaryDialog", () => {
  it("結果が入れ替わると1ページ目・NGのみ表示オフに戻る (Issue #551)", async () => {
    const user = userEvent.setup()
    const onClose = () => {}
    const { rerender } = render(
      <BulkSimulateSummaryDialog results={makeResults(6)} onClose={onClose} />,
    )

    await user.click(screen.getByRole("button", { name: "次へ →" }))
    expect(screen.getByText(/2\/2ページ/)).toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "NGのみ表示" }))

    // 閉じる（results = null）→ 別の結果で開き直す
    rerender(<BulkSimulateSummaryDialog results={null} onClose={onClose} />)
    rerender(<BulkSimulateSummaryDialog results={makeResults(2)} onClose={onClose} />)

    expect(screen.getByText(/1\/1ページ/)).toBeInTheDocument()
    expect(screen.getByText("O-1")).toBeInTheDocument()
    expect(screen.getByText("O-2")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "NGのみ表示" })).not.toBeChecked()
  })

  it("結果が差し替わって総ページ数が減っても空表示にならない", async () => {
    const user = userEvent.setup()
    const onClose = () => {}
    const { rerender } = render(
      <BulkSimulateSummaryDialog results={makeResults(6)} onClose={onClose} />,
    )
    await user.click(screen.getByRole("button", { name: "次へ →" }))

    rerender(<BulkSimulateSummaryDialog results={makeResults(2)} onClose={onClose} />)

    expect(screen.getByText(/1\/1ページ/)).toBeInTheDocument()
    expect(screen.getByText("O-1")).toBeInTheDocument()
  })
})
