import { describe, expect, it, vi } from "vitest"
import { render, screen, userEvent } from "@/test-utils/render"
import { STATUS_TABS } from "@/lib/order-utils"
import type { Customer } from "@/types/customer"
import type { Product } from "@/types/product"
import { OrdersFilterBar } from "./orders-filter-bar"

/**
 * コンポーネントのサンプルテスト（Issue #340）。
 * 表示専用コンポーネントを custom render で描画し、コールバックの発火を検証する。
 */
describe("OrdersFilterBar", () => {
  const defaultProps = {
    statusFilter: "" as const,
    sortKey: "desired_deadline_asc" as const,
    customerFilterId: null,
    productFilterId: null,
    customers: [
      { id: 1, name: "顧客A社", alias: "エー" },
      { id: 2, name: "顧客B社" },
    ] as Customer[],
    products: [{ id: 10, name: "ブラケット", code: "BR-01" }] as Product[],
    onCustomerChange: vi.fn(),
    onProductChange: vi.fn(),
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

  it("顧客を選ぶと onCustomerChange に ID が渡る（略称でも検索できる）", async () => {
    const user = userEvent.setup()
    const onCustomerChange = vi.fn()
    render(<OrdersFilterBar {...defaultProps} onCustomerChange={onCustomerChange} />)

    await user.click(screen.getByRole("combobox", { name: "顧客で絞り込み" }))
    await user.type(screen.getByPlaceholderText("顧客名または略称で検索..."), "エー")
    expect(screen.queryByText("顧客B社")).not.toBeInTheDocument()
    await user.click(screen.getByText("顧客A社"))

    expect(onCustomerChange).toHaveBeenCalledWith("1")
  })

  it("選択中の製品を表示し、「選択を解除」で空文字が渡る", async () => {
    const user = userEvent.setup()
    const onProductChange = vi.fn()
    render(
      <OrdersFilterBar {...defaultProps} productFilterId={10} onProductChange={onProductChange} />,
    )

    const trigger = screen.getByRole("combobox", { name: "製品で絞り込み" })
    expect(trigger).toHaveTextContent("BR-01 - ブラケット")
    await user.click(trigger)
    await user.click(screen.getByText("選択を解除"))

    expect(onProductChange).toHaveBeenCalledWith("")
  })
})
