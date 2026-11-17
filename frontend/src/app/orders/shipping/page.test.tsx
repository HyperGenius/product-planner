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
import type {
  ShipmentOrderReview,
  ShipmentUnmatchedGroup,
  ShipmentUnmatchedList,
} from "@/types/shipment"
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
    window.location.hash = ""
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

  it("弥生で送品が確認できた注文を先頭に候補として出し、一部送品・区別できない明細も示す（Issue #667）", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "OVERDUE", desired_deadline: PAST, quantity: 10 }),
      makeOrder({ id: 2, order_no: "YAYOI-DONE", desired_deadline: FUTURE, quantity: 100 }),
      makeOrder({ id: 3, order_no: "YAYOI-PART", desired_deadline: FUTURE, quantity: 100 }),
    ])
    mockProgress([])
    const entry = (id: number, quantity: number, candidates: number[] = []) => ({
      id,
      sales_date: "2026-10-15",
      slip_no: "1",
      quantity,
      note: null,
      product_name: "品A",
      method: candidates.length ? null : "deadline",
      candidate_order_ids: candidates,
    })
    server.use(
      http.get(`${API_BASE}/shipments/order-matches`, () =>
        HttpResponse.json({
          latest_sales_date: "2026-10-15",
          items: [
            {
              order_id: 2,
              shipped_qty: 100,
              order_quantity: 100,
              is_fully_shipped: true,
              last_sales_date: "2026-10-15",
              entries: [entry(1, 60), entry(2, 40)],
              ambiguous_entries: [],
            },
            {
              order_id: 3,
              shipped_qty: 30,
              order_quantity: 100,
              is_fully_shipped: false,
              last_sales_date: "2026-10-15",
              entries: [entry(3, 30)],
              ambiguous_entries: [entry(4, 5, [3, 9])],
            },
          ],
        }),
      ),
    )
    const user = userEvent.setup()
    render(<OrdersShippingPage />)

    await screen.findByRole("link", { name: "YAYOI-DONE" })
    expect(getBodyRows().map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual([
      "YAYOI-DONE",
      "OVERDUE",
    ])
    const done = getRow("YAYOI-DONE")
    expect(within(done).getByText("弥生で送品済み")).toBeInTheDocument()
    expect(within(done).getByText("/ 100", { exact: false })).toBeInTheDocument()
    // 自動では送品済みにしない（ボタンで担当者が確定する）
    expect(within(done).getByRole("button", { name: /送品済みにする/ })).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "すべて（3）" }))
    const part = getRow("YAYOI-PART")
    expect(within(part).getByText("一部送品")).toBeInTheDocument()
    expect(within(part).getByText("他の受注と区別できない明細 1件")).toBeInTheDocument()
    expect(screen.getByText(/弥生の売上明細: .*売上分まで/)).toBeInTheDocument()
  })

  it("弥生が正である旨を常に出し、候補が無ければその旨を出す", async () => {
    mockOrders([])
    mockProgress([])
    render(<OrdersShippingPage />)

    expect(
      await screen.findByText(/送品の記録は弥生が正です。弥生で送品を確認してから「送品済みにする」を押してください/),
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

function makeUnmatched(overrides: Partial<ShipmentUnmatchedGroup>): ShipmentUnmatchedGroup {
  return {
    status: "no_order",
    customer_code: "001",
    customer_code_key: "001",
    customer_name: "架空工業(株)",
    product_code: "X1",
    product_code_key: "X1",
    product_name: "品A",
    latest_note: null,
    entry_count: 1,
    total_qty: 10,
    last_sales_date: "2026-10-10",
    customer_ids: [],
    product_ids: [],
    note_deadlines: [],
    candidate_order_ids: [],
    ...overrides,
  }
}

function mockUnmatched(items: ShipmentUnmatchedGroup[], extra?: Partial<ShipmentUnmatchedList>) {
  const counts = { unmatched_customer: 0, unmatched_product: 0, no_order: 0, ambiguous: 0 }
  for (const item of items) counts[item.status] += 1
  server.use(
    http.get(`${API_BASE}/shipments/unmatched-entries`, () =>
      HttpResponse.json({
        latest_sales_date: "2026-10-14",
        since: "2026-08-16",
        counts,
        truncated: false,
        items,
        ...extra,
      } satisfies ShipmentUnmatchedList),
    ),
  )
}

describe("OrdersShippingPage のカード（Issue #682）", () => {
  beforeEach(() => {
    window.location.hash = ""
    mockRole("order_handler")
    server.use(
      http.get(`${API_BASE}/customers`, () =>
        HttpResponse.json([{ id: 1, name: "架空工業株式会社", alias: "架空" }]),
      ),
      http.get(`${API_BASE}/products`, () =>
        HttpResponse.json([{ id: 101, name: "品A", code: "DW-1" }]),
      ),
    )
  })

  it("既定は送品の候補を出し、要確認を押すとハッシュに残して受注に当たらない明細だけを出す", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1", desired_deadline: PAST })])
    mockProgress([])
    mockUnmatched([
      makeUnmatched({ status: "unmatched_customer", customer_code: "009", customer_name: "未登録商事" }),
      makeUnmatched({ status: "no_order", product_code: "X2" }),
    ])
    const user = userEvent.setup()
    render(<OrdersShippingPage />)

    expect(await screen.findByRole("button", { name: "送品の候補 1件" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    await waitFor(() => getRow("O-1"))
    const review = await screen.findByRole("button", { name: "要確認 2件" })

    await user.click(review)

    expect(window.location.hash).toBe("#review")
    expect(await screen.findByText("未登録商事")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "O-1" })).toBeNull()
    expect(screen.queryByRole("tab", { name: /候補のみ/ })).toBeNull()
    expect(screen.getAllByTestId("unmatched-shipment-row")).toHaveLength(2)
  })

  it("原因ごとの見出しに直す画面へのリンクを1回だけ出す", async () => {
    window.location.hash = "#review"
    mockOrders([])
    mockProgress([])
    mockUnmatched([
      makeUnmatched({ status: "unmatched_customer" }),
      makeUnmatched({ status: "unmatched_product", product_code: "P1", customer_ids: [1] }),
      makeUnmatched({ status: "unmatched_product", product_code: "P2", customer_ids: [1] }),
      makeUnmatched({ status: "no_order", product_code: "X3" }),
    ])
    render(<OrdersShippingPage />)

    expect(await screen.findByRole("heading", { name: /得意先が未照合\s*1件/ })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /商品コードが未照合\s*2件/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "弥生の名寄せ（得意先）" })).toHaveAttribute(
      "href",
      "/orders/shipment-names#customers",
    )
    expect(screen.getAllByRole("link", { name: "弥生の名寄せ（商品）" })).toHaveLength(1)
    expect(screen.getByRole("link", { name: "弥生の名寄せ（商品）" })).toHaveAttribute(
      "href",
      "/orders/shipment-names#products",
    )
    expect(screen.getByRole("link", { name: "受注の新規作成" })).toHaveAttribute("href", "/orders/new")
    // 受注が区別できない明細が無ければ見出しを出さない
    expect(screen.queryByRole("heading", { name: /受注が区別できない/ })).toBeNull()
  })

  it("受注が無い明細に照合できた顧客・製品と備考の納期分を、区別できない明細に候補の受注を出す", async () => {
    window.location.hash = "#review"
    mockOrders([
      makeOrder({ id: 11, order_no: "O-11", desired_deadline: "2026-10-20", customer_order_no: "PO-9" }),
      makeOrder({ id: 12, order_no: "O-12", desired_deadline: "2026-10-20", status: "shipped" }),
    ])
    mockProgress([])
    mockUnmatched([
      makeUnmatched({
        status: "no_order",
        customer_ids: [1],
        product_ids: [101],
        note_deadlines: ["2026-11-30"],
        entry_count: 2,
        total_qty: 120,
      }),
      makeUnmatched({
        status: "ambiguous",
        product_code: "X9",
        customer_ids: [1],
        product_ids: [101],
        candidate_order_ids: [11, 12],
      }),
    ])
    render(<OrdersShippingPage />)

    const [noOrder, ambiguous] = await screen.findAllByTestId("unmatched-shipment-row")
    expect(within(noOrder).getByText("架空")).toBeInTheDocument()
    expect(within(noOrder).getByText("DW-1 - 品A")).toBeInTheDocument()
    expect(within(noOrder).getByText(/11\/30/)).toBeInTheDocument()
    expect(within(noOrder).getByText("2件")).toBeInTheDocument()
    expect(within(noOrder).getByText("120")).toBeInTheDocument()
    expect(within(ambiguous).getByRole("link", { name: "O-11" })).toHaveAttribute("href", "/orders/11")
    expect(within(ambiguous).getByText(/注番 PO-9/)).toBeInTheDocument()
    expect(within(ambiguous).getByRole("link", { name: "O-12" })).toHaveAttribute("href", "/orders/12")
  })

  it("受注に当たらない明細が無ければその旨を出す", async () => {
    window.location.hash = "#review"
    mockOrders([])
    mockProgress([])
    render(<OrdersShippingPage />)

    expect(await screen.findByText("受注に当たらない弥生の明細はありません")).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "要確認 0件" })).toBeInTheDocument()
  })

  it("知らないハッシュは送品の候補に寄せる", async () => {
    window.location.hash = "#unknown"
    mockOrders([])
    mockProgress([])
    render(<OrdersShippingPage />)

    expect(await screen.findByRole("button", { name: /^送品の候補/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })
})

function makeReview(overrides: Partial<ShipmentOrderReview>): ShipmentOrderReview {
  return {
    order_id: 1,
    product_id: 101,
    cause: "missing_report",
    shipped_qty: 100,
    last_sales_date: "2026-10-10",
    final_process_name: "プレス",
    final_good_qty: 0,
    unallocated_qty: 0,
    process_names: [],
    ...overrides,
  }
}

function mockOrderReviews(items: ShipmentOrderReview[]) {
  const counts = { no_routing: 0, process_mismatch: 0, customer_or_stock: 0, missing_report: 0 }
  for (const item of items) counts[item.cause] += 1
  server.use(
    http.get(`${API_BASE}/shipments/order-reviews`, () =>
      HttpResponse.json({ computed_at: "2099-10-01T01:05:00Z", counts, items }),
    ),
  )
}

describe("OrdersShippingPage の日報が追いついていない注文（Issue #683）", () => {
  beforeEach(() => {
    window.location.hash = ""
    mockRole("order_handler")
    server.use(
      http.get(`${API_BASE}/customers`, () =>
        HttpResponse.json([{ id: 1, name: "架空工業株式会社", alias: "架空" }]),
      ),
      http.get(`${API_BASE}/products`, () =>
        HttpResponse.json([
          { id: 101, name: "品A", code: "DW-1" },
          { id: 102, name: "品B", code: "DW-2" },
        ]),
      ),
    )
  })

  it("送品の候補の行に原因を短く出し、送品済みにするは押せる", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1", desired_deadline: PAST })])
    mockProgress([])
    mockOrderReviews([makeReview({ order_id: 1, cause: "no_routing", final_process_name: null })])
    render(<OrdersShippingPage />)

    const row = await waitFor(() => getRow("O-1"))
    expect(within(row).getByText("日報なし")).toBeInTheDocument()
    expect(await within(row).findByRole("link", { name: "要確認: 工程なし" })).toHaveAttribute(
      "href",
      "#review",
    )
    expect(await within(row).findByRole("button", { name: "送品済みにする" })).toBeEnabled()
  })

  it("要確認では原因ごとの見出しの下に製品の単位でまとめ、展開で注文を出す", async () => {
    window.location.hash = "#review"
    mockOrders([
      makeOrder({ id: 1, order_no: "O-1", product_id: 101, quantity: 60 }),
      makeOrder({ id: 2, order_no: "O-2", product_id: 101, quantity: 40 }),
      makeOrder({ id: 3, order_no: "O-3", product_id: 102 }),
    ])
    mockProgress([])
    mockUnmatched([makeUnmatched({ status: "no_order" })])
    mockOrderReviews([
      makeReview({
        order_id: 1,
        product_id: 101,
        cause: "process_mismatch",
        shipped_qty: 60,
        unallocated_qty: 30,
        process_names: ["ﾌﾟﾚｽ加工"],
      }),
      makeReview({ order_id: 2, product_id: 101, cause: "process_mismatch", shipped_qty: 40 }),
      makeReview({ order_id: 3, product_id: 102, cause: "customer_or_stock", unallocated_qty: 20 }),
    ])
    const user = userEvent.setup()
    render(<OrdersShippingPage />)

    // 受注に当たらない明細1件＋日報が追いついていない注文2製品
    expect(await screen.findByRole("button", { name: "要確認 3件" })).toBeInTheDocument()
    expect(
      await screen.findByRole("heading", { name: /工程名が日報と合わない\s*1製品/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /日報の顧客先が違う／作り置き\s*1製品/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "照合状況（工程マスタ未登録）" })).toHaveAttribute(
      "href",
      "/master/daily-report-coverage#routing",
    )
    expect(screen.queryByRole("heading", { name: /製品に工程が無い/ })).toBeNull()

    const [mismatch, stock] = screen.getAllByTestId("order-review-product-row")
    expect(within(mismatch).getByText("DW-1 - 品A")).toBeInTheDocument()
    expect(within(mismatch).getByText("100")).toBeInTheDocument()
    expect(within(mismatch).getByText("ﾌﾟﾚｽ加工")).toBeInTheDocument()
    expect(within(mismatch).getByRole("link", { name: "製品マスタで工程を開く" })).toHaveAttribute(
      "href",
      "/master/products?highlight=101",
    )
    expect(screen.queryByTestId("order-review-order-row")).toBeNull()

    await user.click(within(mismatch).getByRole("button", { name: "2件の注文" }))
    const orderRows = screen.getAllByTestId("order-review-order-row")
    expect(orderRows.map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual([
      "O-1",
      "O-2",
    ])

    await user.click(within(stock).getByRole("button", { name: "1件の注文" }))
    expect(
      screen.getByRole("link", { name: "受注詳細で作り置きを引き当てる" }),
    ).toHaveAttribute("href", "/orders/3")

    // 受注に当たらない弥生の明細へ切り替えられる
    await user.click(screen.getByRole("tab", { name: "受注に当たらない弥生の明細（1）" }))
    expect(screen.getAllByTestId("unmatched-shipment-row")).toHaveLength(1)
  })

  it("日報の書き漏れには日報の名寄せへのリンクと未照合が含まれる旨を出す", async () => {
    window.location.hash = "#review"
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockProgress([])
    mockOrderReviews([makeReview({ order_id: 1, cause: "missing_report" })])
    render(<OrdersShippingPage />)

    expect(
      await screen.findByRole("heading", { name: /日報の書き漏れ・取り込み漏れ/ }),
    ).toBeInTheDocument()
    expect(screen.getByText(/未照合の明細も割り付けに使われない/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "日報の名寄せ（未照合）" })).toHaveAttribute(
      "href",
      "/master/daily-report-names",
    )
  })
})
