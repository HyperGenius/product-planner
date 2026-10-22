import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { addDaysToIsoDate } from "@/lib/floor-dashboard-utils"
import { jstTodayIso } from "@/lib/order-utils"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { MemberRole } from "@/types/member"
import type { Order } from "@/types/order"
import OrdersShippingPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/shipping",
}))

const PAST = "2000-01-10"
const FUTURE = "2099-12-31"

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: FUTURE,
    confirmed_deadline: FUTURE,
    status: "confirmed",
    customer_certainty: null,
    is_scheduled: true,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function makeProcess(overrides: Partial<ProcessProgress>): ProcessProgress {
  return {
    order_id: 1,
    process_routing_id: 1,
    sequence_order: 1,
    process_name: "プレス",
    good_qty: 0,
    order_quantity: 10,
    first_actual_date: null,
    last_actual_date: null,
    status: "not_started",
    completed_by: null,
    planned_end_datetime: null,
    ...overrides,
  }
}

function mockOrders(orders: Order[]): void {
  server.use(http.get(`${API_BASE}/orders`, () => HttpResponse.json(orders)))
}

/** 進捗を返し、リクエストされた order_id を記録する */
function mockProgress(items: ProcessProgress[], computedAt: string | null = "2099-10-01T01:05:00Z") {
  const requested: number[][] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/order-progress`, ({ request }) => {
      const ids = new URL(request.url).searchParams.getAll("order_id").map(Number)
      requested.push(ids)
      return HttpResponse.json({
        computed_at: computedAt,
        items: items.filter((p) => ids.includes(p.order_id)),
      })
    }),
  )
  return requested
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

describe("OrdersShippingPage（Issue #557）", () => {
  beforeEach(() => {
    mockRole("order_handler")
  })

  it("既定では候補だけを、A かつ B を先頭に納期の古い順で出し、すべてに切り替えると候補でない注文も出す", async () => {
    const soon = addDaysToIsoDate(jstTodayIso(), 3)
    mockOrders([
      makeOrder({ id: 1, order_no: "SOON", desired_deadline: soon }),
      makeOrder({ id: 2, order_no: "OVERDUE", desired_deadline: PAST, status: "in_progress" }),
      makeOrder({ id: 3, order_no: "DONE-OVERDUE", desired_deadline: "2000-02-01" }),
      makeOrder({ id: 4, order_no: "DONE", desired_deadline: FUTURE }),
      makeOrder({ id: 5, order_no: "NOT-YET", desired_deadline: FUTURE }),
      makeOrder({ id: 6, order_no: "SHIPPED", desired_deadline: PAST, status: "shipped" }),
      makeOrder({ id: 7, order_no: "DRAFT", desired_deadline: PAST, status: "draft" }),
    ])
    const requested = mockProgress([
      makeProcess({ order_id: 3, status: "completed", completed_by: "quantity" }),
      makeProcess({ order_id: 4, status: "completed", completed_by: "quantity" }),
      makeProcess({ order_id: 5, status: "in_progress" }),
    ])
    const user = userEvent.setup()
    render(<OrdersShippingPage />)

    await screen.findByRole("link", { name: "DONE-OVERDUE" })
    // 進捗は対象（確定済・生産中）の注文だけをまとめて引く
    expect(requested).toEqual([[1, 2, 3, 4, 5]])
    expect(getBodyRows().map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual([
      "DONE-OVERDUE",
      "OVERDUE",
      "SOON",
      "DONE",
    ])
    expect(screen.queryByText("NOT-YET")).toBeNull()
    expect(screen.queryByText("SHIPPED")).toBeNull()
    expect(screen.queryByText("DRAFT")).toBeNull()

    await user.click(screen.getByRole("tab", { name: "すべて（5）" }))
    expect(getBodyRows()).toHaveLength(5)
    expect(within(getRow("NOT-YET")).getByText("0 / 1")).toBeInTheDocument()
  })

  it("候補の理由と工程の進捗・納期の超過日数を出し、進捗の無い注文は「日報なし」と出す", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "DONE-OVERDUE", desired_deadline: PAST }),
      makeOrder({ id: 2, order_no: "NO-REPORT", desired_deadline: undefined, confirmed_deadline: PAST }),
    ])
    mockProgress([
      makeProcess({ order_id: 1, process_routing_id: 1, sequence_order: 1, status: "completed", completed_by: "later_process" }),
      makeProcess({ order_id: 1, process_routing_id: 2, sequence_order: 2, status: "completed", completed_by: "quantity" }),
    ])
    render(<OrdersShippingPage />)

    const done = await waitFor(() => getRow("DONE-OVERDUE"))
    expect(within(done).getByText("最終工程完了")).toBeInTheDocument()
    expect(within(done).getByText("納期超過")).toBeInTheDocument()
    expect(within(done).getByText("2 / 2")).toBeInTheDocument()
    expect(within(done).getByText(/日超過$/)).toBeInTheDocument()

    const noReport = getRow("NO-REPORT")
    expect(within(noReport).getByText("日報なし")).toBeInTheDocument()
    expect(within(noReport).getByText("納期超過")).toBeInTheDocument()
    expect(within(noReport).queryByText("最終工程完了")).toBeNull()
    // 希望納期が無いので完成見込み（確定納期）で判定している
    expect(within(noReport).getByText("（完成見込み）")).toBeInTheDocument()
  })

  it("弥生が正である旨を常に出し、候補が無ければその旨を出す", async () => {
    mockOrders([])
    mockProgress([])
    render(<OrdersShippingPage />)

    expect(
      await screen.findByText(
        "送品の記録は弥生が正です。弥生で送品を確認してから「送品済みにする」を押してください",
      ),
    ).toBeInTheDocument()
    expect(await screen.findByText("送品済みにする候補の注文はありません")).toBeInTheDocument()
    // 対象が無ければ進捗を取得しない
    expect(screen.getByText("日報の進捗はまだ集計されていません")).toBeInTheDocument()
  })

  it("進捗の最終計算日時を JST で出す", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1", desired_deadline: PAST })])
    mockProgress([], "2099-10-01T01:05:00Z")
    render(<OrdersShippingPage />)

    expect(await screen.findByText("日報の進捗: 99/10/1 10:05 時点")).toBeInTheDocument()
  })

  it.each<MemberRole>(["order_handler", "president"])("%s は1件ずつ送品済みにできる", async (role) => {
    mockRole(role)
    const shipped = vi.fn()
    mockOrders([makeOrder({ id: 1, order_no: "O-1", desired_deadline: PAST })])
    mockProgress([])
    server.use(
      http.post(`${API_BASE}/orders/1/ship`, () => {
        shipped()
        return HttpResponse.json(makeOrder({ id: 1, status: "shipped" }))
      }),
    )
    const user = userEvent.setup()
    render(<OrdersShippingPage />)

    const row = await waitFor(() => getRow("O-1"))
    await user.click(await within(row).findByRole("button", { name: "送品済みにする" }))
    await waitFor(() => expect(shipped).toHaveBeenCalledTimes(1))
    // 一括で送品済みにする操作は無い
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it.each<MemberRole>(["iso_officer", "platform_admin"])("%s は閲覧のみ", async (role) => {
    mockRole(role)
    mockOrders([makeOrder({ id: 1, order_no: "O-1", desired_deadline: PAST })])
    mockProgress([])
    render(<OrdersShippingPage />)

    const row = await waitFor(() => getRow("O-1"))
    // ロールの取得を待ってから、操作が出ていないことを確かめる
    await waitFor(() => expect(within(row).getByText("納期超過")).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(within(row).queryByRole("button", { name: "送品済みにする" })).toBeNull()
  })
})
