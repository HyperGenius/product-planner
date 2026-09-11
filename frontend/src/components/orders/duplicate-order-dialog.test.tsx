import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test-utils/render"
import type { ConflictingOrder } from "@/types/order"
import { DuplicateOrderDialog } from "./duplicate-order-dialog"

function makeConflictingOrder(overrides: Partial<ConflictingOrder> = {}): ConflictingOrder {
  return {
    id: 42,
    order_no: "PO-1234",
    customer_name: "顧客A社",
    product_name: "製品X",
    quantity: 100,
    deadline_date: "2026-10-01",
    status: "confirmed",
    ...overrides,
  }
}

describe("DuplicateOrderDialog", () => {
  it("衝突先レコードの識別情報を表示する", () => {
    render(
      <DuplicateOrderDialog
        open
        onOpenChange={vi.fn()}
        conflictingOrder={makeConflictingOrder()}
      />
    )

    expect(screen.getByText("重複する注文があります")).toBeInTheDocument()
    expect(screen.getByText("PO-1234")).toBeInTheDocument()
    expect(screen.getByText("顧客A社")).toBeInTheDocument()
    expect(screen.getByText("製品X")).toBeInTheDocument()
    expect(screen.getByText("100")).toBeInTheDocument()
    expect(screen.getByText("2026/10/01")).toBeInTheDocument()
    expect(screen.getByText("確定")).toBeInTheDocument()
  })

  it("衝突先レコードが取得できない場合は識別情報を表示しない", () => {
    render(
      <DuplicateOrderDialog open onOpenChange={vi.fn()} conflictingOrder={undefined} />
    )

    expect(screen.getByText("重複する注文があります")).toBeInTheDocument()
    expect(screen.queryByText("注文番号")).not.toBeInTheDocument()
  })

  it("lineItemIndex が指定されると重複した明細番号を案内に含める（メール起票用）", () => {
    render(
      <DuplicateOrderDialog
        open
        onOpenChange={vi.fn()}
        conflictingOrder={makeConflictingOrder()}
        lineItemIndex={1}
      />
    )

    expect(screen.getByText(/明細 2:/)).toBeInTheDocument()
  })
})
