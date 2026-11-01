import { describe, expect, it } from "vitest"
import { render, screen } from "@/test-utils/render"
import type { Order } from "@/types/order"
import { BulkApproveConfirmDialog } from "./bulk-approve-confirm-dialog"

function makeOrder(id: number, desired: string, simulated: string): Order {
  return {
    id,
    order_no: `O-${id}`,
    product_id: null,
    extracted_product_name: `品名${id}`,
    desired_deadline: desired,
    simulated_deadline: simulated,
  } as Order
}

function renderDialog(orders: Order[]) {
  return render(
    <BulkApproveConfirmDialog
      open
      orders={orders}
      isPending={false}
      onConfirm={() => {}}
      onCancel={() => {}}
    />,
  )
}

describe("BulkApproveConfirmDialog (Issue #617)", () => {
  it("納期超過の件数を説明文に出し、超過行を先頭に並べる", () => {
    renderDialog([
      makeOrder(1, "2026-12-03", "2026-10-13"),
      makeOrder(2, "2026-10-01", "2026-10-05"),
    ])
    expect(screen.getByText(/うち納期超過 1件/)).toBeInTheDocument()
    const rows = screen.getAllByRole("row")
    // rows[0] は見出し
    expect(rows[1]).toHaveTextContent("O-2")
    expect(rows[2]).toHaveTextContent("O-1")
  })

  it("超過が無いときは件数を出さない", () => {
    renderDialog([makeOrder(1, "2026-12-03", "2026-10-13")])
    expect(screen.queryByText(/納期超過/)).not.toBeInTheDocument()
  })
})
