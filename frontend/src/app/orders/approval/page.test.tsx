import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { MemberRole } from "@/types/member"
import type { Order } from "@/types/order"
import OrdersApprovalPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/approval",
}))

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: "2099-09-30",
    simulated_deadline: "2099-09-20",
    status: "pending_approval",
    customer_certainty: null,
    is_scheduled: true,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    approval_requested_at: "2099-09-01T01:00:00Z",
    approval_requested_by_name: "受注担当A",
    ...overrides,
  }
}

function mockOrders(orders: Order[]): void {
  server.use(http.get(`${API_BASE}/orders`, () => HttpResponse.json(orders)))
}

function mockRole(role: MemberRole): void {
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role }),
    ),
  )
}

/** 見出し行を除いた行（表示順） */
function getBodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1)
}

function getRow(orderNo: string): HTMLElement {
  const row = screen.getByRole("link", { name: orderNo }).closest("tr")
  if (!row) throw new Error(`row not found: ${orderNo}`)
  return row
}

describe("OrdersApprovalPage（Issue #556）", () => {
  beforeEach(() => {
    mockRole("president")
  })

  it("承認待ちだけを承認依頼の古い順に出し、依頼日時の無い注文は末尾に置く", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "NEW", approval_requested_at: "2099-09-03T00:00:00Z" }),
      makeOrder({ id: 2, order_no: "LEGACY", approval_requested_at: null, approval_requested_by_name: null }),
      makeOrder({ id: 3, order_no: "OLD", approval_requested_at: "2099-09-01T00:00:00Z" }),
      makeOrder({ id: 4, order_no: "DRAFT", status: "draft" }),
      makeOrder({ id: 5, order_no: "CONFIRMED", status: "confirmed" }),
    ])
    render(<OrdersApprovalPage />)

    await screen.findByRole("link", { name: "OLD" })
    const rows = getBodyRows()
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByRole("link", { name: "OLD" })).toBeInTheDocument()
    expect(within(rows[1]).getByRole("link", { name: "NEW" })).toBeInTheDocument()
    expect(within(rows[2]).getByRole("link", { name: "LEGACY" })).toBeInTheDocument()
    expect(screen.queryByText("DRAFT")).toBeNull()
    expect(screen.queryByText("CONFIRMED")).toBeNull()
  })

  it("依頼者と依頼日時（JST）、シミュ納期の希望納期との差を出す", async () => {
    mockOrders([
      makeOrder({
        id: 1,
        order_no: "OVERRUN",
        desired_deadline: "2099-09-10",
        simulated_deadline: "2099-09-13",
        approval_requested_at: "2099-09-01T01:05:00Z",
      }),
      makeOrder({ id: 2, order_no: "EARLY", desired_deadline: "2099-09-30", simulated_deadline: "2099-09-28" }),
    ])
    render(<OrdersApprovalPage />)

    const overrun = await waitFor(() => getRow("OVERRUN"))
    expect(within(overrun).getByText("3日超過")).toBeInTheDocument()
    expect(within(overrun).getByText("受注担当A")).toBeInTheDocument()
    expect(within(overrun).getByText("99/9/1 10:05")).toBeInTheDocument()
    expect(overrun).toHaveClass("bg-red-50")

    const early = getRow("EARLY")
    expect(within(early).getByText("2日前")).toBeInTheDocument()
    expect(early).not.toHaveClass("bg-red-50")
  })

  it("社長には承認・差し戻し・一括承認の選択を出し、取り下げは出さない", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "P-1" })])
    render(<OrdersApprovalPage />)

    const row = await waitFor(() => getRow("P-1"))
    await waitFor(() => expect(within(row).getByRole("button", { name: "承認" })).toBeInTheDocument())
    expect(within(row).getByRole("button", { name: "差し戻し" })).toBeInTheDocument()
    expect(within(row).getByRole("checkbox", { name: "注文 P-1 を選択" })).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "承認待ちをすべて選択" })).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: "取り下げ" })).toBeNull()
  })

  it("受注担当には取り下げだけを出す", async () => {
    mockRole("order_handler")
    const withdrawn = vi.fn()
    mockOrders([makeOrder({ id: 1, order_no: "P-1" })])
    server.use(
      http.post(`${API_BASE}/orders/1/withdraw-approval`, () => {
        withdrawn()
        return HttpResponse.json(makeOrder({ id: 1, status: "draft" }))
      }),
    )
    const user = userEvent.setup()
    render(<OrdersApprovalPage />)

    const row = await waitFor(() => getRow("P-1"))
    await user.click(await within(row).findByRole("button", { name: "取り下げ" }))
    await waitFor(() => expect(withdrawn).toHaveBeenCalled())

    expect(within(row).queryByRole("button", { name: "承認" })).toBeNull()
    expect(within(row).queryByRole("button", { name: "差し戻し" })).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it.each<MemberRole>(["iso_officer", "platform_admin"])("%s は閲覧のみ", async (role) => {
    mockRole(role)
    mockOrders([makeOrder({ id: 1, order_no: "P-1" })])
    render(<OrdersApprovalPage />)

    const row = await waitFor(() => getRow("P-1"))
    // ロールの取得を待ってから、操作が出ていないことを確かめる
    await waitFor(() => expect(within(row).getByText("受注担当A")).toBeInTheDocument())
    expect(within(row).queryByRole("button")).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("社長は確認モーダルを挟んで承認し、承認した注文は画面から外れる", async () => {
    let orders = [makeOrder({ id: 1, order_no: "P-1" })]
    const confirmed = vi.fn()
    server.use(
      http.get(`${API_BASE}/orders`, () => HttpResponse.json(orders)),
      http.post(`${API_BASE}/orders/1/confirm`, () => {
        confirmed()
        orders = orders.map((o) => ({ ...o, status: "confirmed" as const }))
        return HttpResponse.json(orders[0])
      }),
    )
    const user = userEvent.setup()
    render(<OrdersApprovalPage />)

    const row = await waitFor(() => getRow("P-1"))
    await user.click(await within(row).findByRole("button", { name: "承認" }))
    expect(confirmed).not.toHaveBeenCalled()
    await user.click(await screen.findByRole("button", { name: "承認する" }))

    await waitFor(() => expect(confirmed).toHaveBeenCalled())
    expect(await screen.findByText("承認待ちの注文はありません")).toBeInTheDocument()
  })

  it("社長は選んだ注文を確認モーダルを挟んで一括承認できる", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "P-1" }), makeOrder({ id: 2, order_no: "P-2" })])
    let approvedIds: number[] = []
    server.use(
      http.post(`${API_BASE}/orders/approve-bulk`, async ({ request }) => {
        approvedIds = ((await request.json()) as { order_ids: number[] }).order_ids
        return HttpResponse.json({
          results: approvedIds.map((id) => ({ order_id: id, status: "confirmed" })),
        })
      }),
    )
    const user = userEvent.setup()
    render(<OrdersApprovalPage />)

    await user.click(await screen.findByRole("checkbox", { name: "承認待ちをすべて選択" }))
    // 承認待ちだけの画面なので一括シミュレーションは出さない
    expect(screen.queryByRole("button", { name: /一括シミュレーション/ })).toBeNull()
    await user.click(screen.getByRole("button", { name: "一括承認（2件）" }))
    await user.click(await screen.findByRole("button", { name: "承認する" }))

    await waitFor(() => expect(approvedIds).toEqual([1, 2]))
  })

  it("社長は理由を入力して差し戻せる", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "P-1" })])
    let rejectBody: unknown = null
    server.use(
      http.post(`${API_BASE}/orders/1/reject`, async ({ request }) => {
        rejectBody = await request.json()
        return HttpResponse.json(makeOrder({ id: 1, status: "draft" }))
      }),
    )
    const user = userEvent.setup()
    render(<OrdersApprovalPage />)

    const row = await waitFor(() => getRow("P-1"))
    await user.click(await within(row).findByRole("button", { name: "差し戻し" }))
    await user.type(await screen.findByLabelText("差し戻し理由（任意）"), "納期を再確認してください")
    await user.click(screen.getByRole("button", { name: "差し戻す" }))

    await waitFor(() => expect(rejectBody).toEqual({ reason: "納期を再確認してください" }))
  })
})
