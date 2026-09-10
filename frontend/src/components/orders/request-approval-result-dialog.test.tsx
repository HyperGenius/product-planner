import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@/test-utils/render"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"
import { RequestApprovalResultDialog } from "./request-approval-result-dialog"

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: "2026-09-30",
    status: "pending_approval",
    customer_certainty: null,
    is_scheduled: true,
    source_type: "email",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

const products: Product[] = [
  { id: 1, code: "P-100", name: "テスト製品", tenant_id: "t1" } as Product,
]
const customers: Customer[] = [
  { id: 1, name: "顧客A社", status: "active", tenant_id: "t1", created_at: "", updated_at: "" },
]

describe("RequestApprovalResultDialog", () => {
  it("依頼した注文の主要項目を表示する", () => {
    render(
      <RequestApprovalResultDialog
        order={makeOrder({ simulated_deadline: "2026-10-05" })}
        products={products}
        customers={customers}
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getByText("承認依頼を送信しました")).toBeInTheDocument()
    expect(screen.getByText("O-1")).toBeInTheDocument()
    expect(screen.getByText("顧客A社")).toBeInTheDocument()
    expect(screen.getByText(/テスト製品/)).toBeInTheDocument()
    expect(screen.getByText("10")).toBeInTheDocument()
    expect(screen.getByText("2026/09/30")).toBeInTheDocument()
    expect(screen.getByText("2026/10/05")).toBeInTheDocument()
  })

  it("order_no が null の注文でも空欄ではなく「未設定」を表示する（旧トーストの「」空欄バグ回帰）", () => {
    render(
      <RequestApprovalResultDialog
        order={makeOrder({ order_no: null })}
        products={products}
        customers={customers}
        onOpenChange={vi.fn()}
      />
    )

    expect(screen.getAllByText("未設定").length).toBeGreaterThan(0)
  })

  it("order が null のときは何も表示しない", () => {
    render(
      <RequestApprovalResultDialog order={null} onOpenChange={vi.fn()} />
    )

    expect(screen.queryByText("承認依頼を送信しました")).not.toBeInTheDocument()
  })
})
