import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Order } from "@/types/order"
import { EditOrderDialog } from "./edit-order-dialog"

/**
 * PATCH /orders/{id} の重複（409 duplicate_order）で衝突先レコードを示す
 * DuplicateOrderDialog が開くことを検証する（Issue #415 PR3）。
 */

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: "2026-09-30",
    status: "draft",
    customer_certainty: null,
    is_scheduled: false,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function mockCurrentMember(): void {
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({
        user_id: "u-1",
        email: "member@example.com",
        full_name: "テスト メンバー",
        role: "order_handler",
      }),
    ),
  )
}

function mockCustomers(): void {
  server.use(http.get(`${API_BASE}/customers`, () => HttpResponse.json([])))
}

describe("EditOrderDialog", () => {
  it("重複起票（409 duplicate_order）を検知したら衝突先レコードを示すモーダルを開く", async () => {
    mockCurrentMember()
    mockCustomers()
    server.use(
      http.patch(`${API_BASE}/orders/1`, () =>
        HttpResponse.json(
          {
            detail: {
              error: "duplicate_order",
              message: "同じ 顧客 × 製品 × 納期 の注文がすでに存在します",
              conflicting_order: {
                id: 99,
                order_no: "PO-9999",
                customer_name: "顧客B社",
                product_name: "製品Y",
                quantity: 50,
                deadline_date: "2026-10-01",
                status: "confirmed",
              },
            },
          },
          { status: 409 },
        ),
      ),
    )

    render(
      <EditOrderDialog order={makeOrder()} open onOpenChange={vi.fn()} />
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "保存" }))

    expect(await screen.findByText("重複する注文があります")).toBeInTheDocument()
    expect(screen.getByText("PO-9999")).toBeInTheDocument()
    expect(screen.getByText("顧客B社")).toBeInTheDocument()
    expect(screen.getByText("製品Y")).toBeInTheDocument()

    // 旧仕様の誤ったインライン文言（注文番号欄の下）は出ない
    expect(
      screen.queryByText("この注文番号はすでに使用されています"),
    ).not.toBeInTheDocument()
  })

  it("注文番号の重複（409 duplicate_order_number）は従来通りトーストのみで、モーダルは開かない", async () => {
    mockCurrentMember()
    mockCustomers()
    server.use(
      http.patch(`${API_BASE}/orders/1`, () =>
        HttpResponse.json(
          {
            detail: {
              error: "duplicate_order_number",
              message: "この注文番号はすでに使用されています",
            },
          },
          { status: 409 },
        ),
      ),
    )

    render(
      <EditOrderDialog order={makeOrder()} open onOpenChange={vi.fn()} />
    )

    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(screen.queryByText("重複する注文があります")).not.toBeInTheDocument(),
    )
  })
})
