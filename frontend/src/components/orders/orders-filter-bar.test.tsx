import { describe, expect, it, vi } from "vitest"
import { render, screen, userEvent } from "@/test-utils/render"
import { STATUS_TABS } from "@/lib/order-utils"
import { OrdersFilterBar } from "./orders-filter-bar"

/**
 * コンポーネントのサンプルテスト（Issue #340）。
 * 表示専用コンポーネントを custom render で描画し、コールバックの発火を検証する。
 */
describe("OrdersFilterBar", () => {
  const defaultProps = {
    statusFilter: "" as const,
    sortKey: "desired_deadline_asc" as const,
    onStatusChange: vi.fn(),
    onSortChange: vi.fn(),
  }

  it("すべてのステータスタブを描画する", () => {
    render(<OrdersFilterBar {...defaultProps} />)

    for (const tab of STATUS_TABS) {
      expect(screen.getByRole("tab", { name: tab.label })).toBeInTheDocument()
    }
  })

  it("タブをクリックすると onStatusChange にその値が渡る", async () => {
    const user = userEvent.setup()
    const onStatusChange = vi.fn()
    render(<OrdersFilterBar {...defaultProps} onStatusChange={onStatusChange} />)

    await user.click(screen.getByRole("tab", { name: "承認待ち" }))

    expect(onStatusChange).toHaveBeenCalledWith("pending_approval")
  })

  it("選択中のタブが aria-selected になる", () => {
    render(<OrdersFilterBar {...defaultProps} statusFilter="confirmed" />)

    expect(screen.getByRole("tab", { name: "確定済" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })
})
