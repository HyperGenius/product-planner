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

  it("注文番号・希望納期・顧客を空欄にして保存すると null で送る（Issue #518）", async () => {
    mockCurrentMember()
    mockCustomers()
    const patches: unknown[] = []
    server.use(
      http.patch(`${API_BASE}/orders/1`, async ({ request }) => {
        patches.push(await request.json())
        return HttpResponse.json(makeOrder())
      }),
    )

    render(
      <EditOrderDialog order={makeOrder()} open onOpenChange={vi.fn()} />
    )

    const user = userEvent.setup()
    await user.clear(screen.getByLabelText("注文番号（任意）"))
    await user.clear(screen.getByLabelText("希望納期"))
    await user.click(screen.getByRole("combobox", { name: "顧客" }))
    await user.click(screen.getByText("選択を解除"))
    await user.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toMatchObject({
      order_no: null,
      desired_deadline: null,
      customer_id: null,
    })
  })

  describe("読み取り専用の参照項目（Issue #565）", () => {
    it("受注日・顧客注番を読み取り専用で表示する", () => {
      mockCurrentMember()
      mockCustomers()
      render(
        <EditOrderDialog
          order={makeOrder({ order_date: "2026-10-05", customer_order_no: "CO-123" })}
          open
          onOpenChange={vi.fn()}
        />
      )

      const orderDate = screen.getByLabelText("受注日")
      expect(orderDate).toHaveValue("2026/10/05")
      expect(orderDate).toHaveAttribute("readonly")
      const customerOrderNo = screen.getByLabelText("顧客注番")
      expect(customerOrderNo).toHaveValue("CO-123")
      expect(customerOrderNo).toHaveAttribute("readonly")
    })

    it("order_date が無ければ created_at、顧客注番が無ければ「未設定」を出す", () => {
      mockCurrentMember()
      mockCustomers()
      render(
        <EditOrderDialog
          order={makeOrder({ order_date: null, created_at: "2026-10-03T01:00:00+00:00" })}
          open
          onOpenChange={vi.fn()}
        />
      )

      expect(screen.getByLabelText("受注日")).toHaveValue("2026/10/03")
      expect(screen.getByLabelText("顧客注番")).toHaveAttribute("placeholder", "未設定")
    })

    it("製品未確定のときだけ抽出した製品名を表示する", () => {
      mockCurrentMember()
      mockCustomers()
      render(
        <EditOrderDialog
          order={makeOrder({ product_id: null, extracted_product_name: "抽出された品名" })}
          open
          onOpenChange={vi.fn()}
        />
      )

      expect(screen.getByLabelText("抽出した製品名")).toHaveValue("抽出された品名")
    })

    it("製品が確定済みなら抽出した製品名を表示しない", () => {
      mockCurrentMember()
      mockCustomers()
      render(
        <EditOrderDialog
          order={makeOrder({ extracted_product_name: "抽出された品名" })}
          open
          onOpenChange={vi.fn()}
        />
      )

      expect(screen.queryByLabelText("抽出した製品名")).not.toBeInTheDocument()
    })

    it("修理注文では抽出した製品名を表示しない", () => {
      mockCurrentMember()
      mockCustomers()
      render(
        <EditOrderDialog
          order={makeOrder({ order_type: "repair", product_id: null, quantity: null })}
          open
          onOpenChange={vi.fn()}
        />
      )

      expect(screen.queryByLabelText("抽出した製品名")).not.toBeInTheDocument()
    })

    it("3項目は PATCH のペイロードに含めない", async () => {
      mockCurrentMember()
      mockCustomers()
      const patches: Record<string, unknown>[] = []
      server.use(
        http.patch(`${API_BASE}/orders/1`, async ({ request }) => {
          patches.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(makeOrder())
        }),
      )
      render(
        <EditOrderDialog
          order={makeOrder({ order_date: "2026-10-05", customer_order_no: "CO-123" })}
          open
          onOpenChange={vi.fn()}
        />
      )

      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "保存" }))

      await waitFor(() => expect(patches).toHaveLength(1))
      expect(patches[0]).not.toHaveProperty("order_date")
      expect(patches[0]).not.toHaveProperty("customer_order_no")
      expect(patches[0]).not.toHaveProperty("extracted_product_name")
    })
  })

  describe("顧客不明の注文の紐づけ（Issue #609）", () => {
    const CONTEXT = {
      sender_email: "taro@example.com",
      contact_owner_customer_id: null,
      candidate_customer_ids: [2],
      same_sender_order_count: 2,
    }

    function mockUnknownCustomerSetup(context: Record<string, unknown> = CONTEXT) {
      mockCurrentMember()
      server.use(
        http.get(`${API_BASE}/customers`, () =>
          HttpResponse.json([
            { id: 1, name: "顧客A社", status: "active", tenant_id: "t1" },
            { id: 2, name: "顧客B社", status: "active", tenant_id: "t1" },
          ]),
        ),
        http.get(`${API_BASE}/orders/1/customer-link-context`, () =>
          HttpResponse.json(context),
        ),
      )
    }

    async function selectCustomer(name: string) {
      const user = userEvent.setup()
      const trigger = await screen.findByRole("combobox", { name: "顧客" })
      await waitFor(() => expect(trigger).toBeEnabled())
      await user.click(trigger)
      await user.click(await screen.findByRole("option", { name: new RegExp(name) }))
      return user
    }

    it("顧客を選ぶと差出人の登録とまとめて紐づけの選択肢が出て、PATCH に customer_id を含めず専用 API で紐づける", async () => {
      mockUnknownCustomerSetup()
      const patches: Record<string, unknown>[] = []
      const links: unknown[] = []
      server.use(
        http.patch(`${API_BASE}/orders/1`, async ({ request }) => {
          patches.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(makeOrder({ customer_id: undefined }))
        }),
        http.post(`${API_BASE}/orders/1/link-customer`, async ({ request }) => {
          links.push(await request.json())
          return HttpResponse.json({
            contact_registered: true,
            sender_email: "taro@example.com",
            linked_order_ids: [1, 5, 6],
            skipped_order_ids: [],
            linked_staging_count: 0,
          })
        }),
      )
      const onOpenChange = vi.fn()
      render(
        <EditOrderDialog
          order={makeOrder({ customer_id: undefined })}
          open
          onOpenChange={onOpenChange}
        />,
      )

      expect(await screen.findByText("taro@example.com")).toBeInTheDocument()
      // 未選択のうちは登録のチェックボックスを出さない
      expect(screen.queryByLabelText(/担当者として登録する/)).not.toBeInTheDocument()

      const user = await selectCustomer("顧客A社")
      expect(await screen.findByLabelText(/顧客A社の担当者として登録する/)).toBeChecked()
      expect(screen.getByLabelText(/顧客不明の注文2件にも/)).toBeChecked()

      await user.click(screen.getByRole("button", { name: "保存" }))

      await waitFor(() => expect(links).toHaveLength(1))
      expect(links[0]).toEqual({
        customer_id: 1,
        register_contact: true,
        apply_to_same_sender: true,
      })
      expect(patches[0]).not.toHaveProperty("customer_id")
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    })

    it("チェックを外すと担当者の登録・まとめ直しをしない", async () => {
      mockUnknownCustomerSetup()
      const links: unknown[] = []
      server.use(
        http.patch(`${API_BASE}/orders/1`, () => HttpResponse.json(makeOrder())),
        http.post(`${API_BASE}/orders/1/link-customer`, async ({ request }) => {
          links.push(await request.json())
          return HttpResponse.json({
            contact_registered: false,
            sender_email: "taro@example.com",
            linked_order_ids: [1],
            skipped_order_ids: [],
            linked_staging_count: 0,
          })
        }),
      )
      render(
        <EditOrderDialog order={makeOrder({ customer_id: undefined })} open onOpenChange={vi.fn()} />,
      )

      const user = await selectCustomer("顧客A社")
      await user.click(await screen.findByLabelText(/担当者として登録する/))
      await user.click(screen.getByLabelText(/顧客不明の注文2件にも/))
      await user.click(screen.getByRole("button", { name: "保存" }))

      await waitFor(() => expect(links).toHaveLength(1))
      expect(links[0]).toEqual({
        customer_id: 1,
        register_contact: false,
        apply_to_same_sender: false,
      })
    })

    it("差出人が別の顧客の担当者として登録済みなら、登録の選択肢を出さず登録しない", async () => {
      mockUnknownCustomerSetup({ ...CONTEXT, contact_owner_customer_id: 2 })
      const links: unknown[] = []
      server.use(
        http.patch(`${API_BASE}/orders/1`, () => HttpResponse.json(makeOrder())),
        http.post(`${API_BASE}/orders/1/link-customer`, async ({ request }) => {
          links.push(await request.json())
          return HttpResponse.json({
            contact_registered: false,
            sender_email: "taro@example.com",
            linked_order_ids: [1],
            skipped_order_ids: [],
            linked_staging_count: 0,
          })
        }),
      )
      render(
        <EditOrderDialog order={makeOrder({ customer_id: undefined })} open onOpenChange={vi.fn()} />,
      )

      const user = await selectCustomer("顧客A社")

      expect(await screen.findByText(/別の顧客の担当者として登録済みのため/)).toBeInTheDocument()
      expect(screen.queryByLabelText(/担当者として登録する/)).not.toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "保存" }))
      await waitFor(() => expect(links).toHaveLength(1))
      expect(links[0]).toMatchObject({ register_contact: false })
    })

    it("紐づけが 409 contact_owned_by_other_customer のときはダイアログを閉じない", async () => {
      mockUnknownCustomerSetup()
      server.use(
        http.patch(`${API_BASE}/orders/1`, () => HttpResponse.json(makeOrder())),
        http.post(`${API_BASE}/orders/1/link-customer`, () =>
          HttpResponse.json(
            { detail: { error: "contact_owned_by_other_customer", message: "x" } },
            { status: 409 },
          ),
        ),
      )
      const onOpenChange = vi.fn()
      render(
        <EditOrderDialog
          order={makeOrder({ customer_id: undefined })}
          open
          onOpenChange={onOpenChange}
        />,
      )

      const user = await selectCustomer("顧客A社")
      await user.click(screen.getByRole("button", { name: "保存" }))

      await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeEnabled())
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })

    it("顧客が設定済みの注文では紐づけの案内を出さず、従来どおり PATCH に customer_id を含める", async () => {
      mockCurrentMember()
      mockCustomers()
      const patches: Record<string, unknown>[] = []
      server.use(
        http.patch(`${API_BASE}/orders/1`, async ({ request }) => {
          patches.push((await request.json()) as Record<string, unknown>)
          return HttpResponse.json(makeOrder())
        }),
      )
      render(<EditOrderDialog order={makeOrder()} open onOpenChange={vi.fn()} />)

      const user = userEvent.setup()
      await user.click(screen.getByRole("button", { name: "保存" }))

      await waitFor(() => expect(patches).toHaveLength(1))
      expect(patches[0]).toHaveProperty("customer_id", 1)
      expect(screen.queryByText(/差出人/)).not.toBeInTheDocument()
    })
  })
})
