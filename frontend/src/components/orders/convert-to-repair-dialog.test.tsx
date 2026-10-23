import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Order } from "@/types/order"
import { ConvertToRepairDialog } from "./convert-to-repair-dialog"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/** 生産として起票された下書きを修理等へ変更するモーダル（Issue #568） */

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: null,
    customer_id: undefined,
    quantity: 11,
    extracted_product_name: "基板 はんだ補修",
    desired_deadline: "2099-11-10",
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

function mockMasters(): void {
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({
        user_id: "u-1",
        email: "member@example.com",
        full_name: "テスト メンバー",
        role: "order_handler",
      }),
    ),
    http.get(`${API_BASE}/customers`, () => HttpResponse.json([])),
  )
}

describe("ConvertToRepairDialog", () => {
  it("読み取った品名を作業内容の初期値にし、変更を送ってダイアログを閉じる", async () => {
    mockMasters()
    let requestBody: unknown
    server.use(
      http.post(`${API_BASE}/orders/1/convert-to-repair`, async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({ ...makeOrder(), order_type: "repair", product_id: null })
      }),
    )
    const onOpenChange = vi.fn()
    const onConverted = vi.fn()
    render(
      <ConvertToRepairDialog
        order={makeOrder()}
        open
        onOpenChange={onOpenChange}
        onConverted={onConverted}
      />,
    )

    expect(screen.getByLabelText("件名・作業内容 *")).toHaveValue("基板 はんだ補修 ×11")
    await userEvent.click(screen.getByRole("button", { name: "修理等に変更" }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(requestBody).toEqual({
      order_no: "O-1",
      customer_id: null,
      work_description: "基板 はんだ補修 ×11",
      desired_deadline: "2099-11-10",
      scheduling_start_date: null,
      simulated_deadline: null,
    })
    expect(onConverted).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith("注文「O-1」を修理等に変更しました")
  })

  it("作業内容が空なら送信しない", async () => {
    mockMasters()
    const onOpenChange = vi.fn()
    render(
      <ConvertToRepairDialog
        order={makeOrder({ extracted_product_name: null, quantity: null })}
        open
        onOpenChange={onOpenChange}
      />,
    )

    await userEvent.click(screen.getByRole("button", { name: "修理等に変更" }))

    expect(toast.error).toHaveBeenCalledWith("件名・作業内容を入力してください")
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("修理の重複（409 duplicate_repair_order）は固定文言を出して開いたままにする", async () => {
    mockMasters()
    server.use(
      http.post(`${API_BASE}/orders/1/convert-to-repair`, () =>
        HttpResponse.json(
          { detail: { error: "duplicate_repair_order", message: "server message" } },
          { status: 409 },
        ),
      ),
    )
    const onOpenChange = vi.fn()
    render(<ConvertToRepairDialog order={makeOrder()} open onOpenChange={onOpenChange} />)

    await userEvent.click(screen.getByRole("button", { name: "修理等に変更" }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "同じ顧客・注文番号の修理等の注文がすでに登録されています",
      ),
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})
