import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"
import { OrderViewDialog } from "./order-view-dialog"

/**
 * 注文を読み取り専用で表示する確認モーダル（Issue #527。全ステータスで開く、Issue #558）。
 */

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 1200,
    desired_deadline: "2026-09-30",
    scheduling_start_date: "2026-09-01",
    confirmed_deadline: "2026-09-25",
    status: "confirmed",
    customer_certainty: "forecast",
    is_scheduled: true,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

const products = [{ id: 1, code: "A-100", name: "部品A" }] as Product[]
const customers = [{ id: 1, name: "顧客A社" }] as Customer[]

function renderDialog(order: Order, onOpenChange = vi.fn()) {
  render(
    <OrderViewDialog
      order={order}
      products={products}
      customers={customers}
      open
      onOpenChange={onOpenChange}
    />,
  )
  return { onOpenChange }
}

describe("OrderViewDialog", () => {
  it("編集モーダルと同じ項目を読み取り専用の入力欄で表示する", () => {
    renderDialog(makeOrder())

    expect(screen.getByRole("heading", { name: "注文の確認" })).toBeInTheDocument()
    const fields: [string, string][] = [
      ["注文番号", "O-1"],
      ["製品", "A-100 - 部品A"],
      ["顧客", "顧客A社"],
      ["数量", "1,200"],
      ["希望納期", "2026/09/30"],
      ["作業開始日", "2026/09/01"],
      ["確定納期", "2026/09/25"],
    ]
    for (const [label, value] of fields) {
      const input = screen.getByLabelText(label)
      expect(input).toHaveValue(value)
      expect(input).toHaveAttribute("readonly")
    }
    expect(screen.getByText("確定")).toBeInTheDocument()
    expect(screen.getByText("内示")).toBeInTheDocument()
  })

  it("承認前の注文はシミュ納期と実効ステータス（シミュ済）を出す（Issue #558）", () => {
    renderDialog(
      makeOrder({
        status: "draft",
        is_scheduled: true,
        confirmed_deadline: undefined,
        simulated_deadline: "2026-09-20",
      }),
    )

    expect(screen.getByLabelText("シミュ納期")).toHaveValue("2026/09/20")
    expect(screen.queryByLabelText("確定納期")).not.toBeInTheDocument()
    expect(screen.getByText("シミュ済")).toBeInTheDocument()
  })

  it("保存ボタンを出さず、詳細ページへのリンクを出す", () => {
    renderDialog(makeOrder())

    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "詳細ページを開く" })).toHaveAttribute(
      "href",
      "/orders/1",
    )
  })

  it("入力しても値は変わらない", async () => {
    renderDialog(makeOrder())

    const input = screen.getByLabelText("数量")
    await userEvent.setup().type(input, "9")

    expect(input).toHaveValue("1,200")
  })

  it("未設定の項目は「未設定」、メール起票で顧客不明なら「顧客不明」をプレースホルダに出す", () => {
    server.use(http.get(`${API_BASE}/orders/1/attachments`, () => HttpResponse.json([])))
    renderDialog(
      makeOrder({
        customer_id: undefined,
        scheduling_start_date: null,
        source_type: "email",
        source_raw: "件名: 注文書\n\n本文",
      }),
    )

    expect(screen.getByLabelText("作業開始日")).toHaveAttribute("placeholder", "未設定")
    expect(screen.getByLabelText("顧客")).toHaveAttribute("placeholder", "顧客不明")
    // メール起票の注文は編集モーダルと同じく参照元メールを並べる
    expect(screen.getByText("参照元メール")).toBeInTheDocument()
  })

  it("「閉じる」で onOpenChange(false) を呼ぶ", async () => {
    const { onOpenChange } = renderDialog(makeOrder())

    await userEvent.setup().click(screen.getByRole("button", { name: "閉じる" }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
