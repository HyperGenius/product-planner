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
  ShipmentEntryRef,
  ShipmentOrderMatch,
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

function makeEntry(id: number, quantity: number, candidates: number[] = []): ShipmentEntryRef {
  return {
    id,
    sales_date: "2026-10-15",
    slip_no: "1",
    quantity,
    note: null,
    product_name: "品A",
    method: candidates.length ? null : "deadline",
    candidate_order_ids: candidates,
  }
}

function makeMatch(overrides: Partial<ShipmentOrderMatch>): ShipmentOrderMatch {
  return {
    order_id: 1,
    shipped_qty: 10,
    order_quantity: 10,
    is_fully_shipped: true,
    last_sales_date: "2026-10-15",
    entries: [makeEntry(1, 10)],
    ambiguous_entries: [],
    ...overrides,
  }
}

function mockMatches(items: ShipmentOrderMatch[]): void {
  server.use(
    http.get(`${API_BASE}/shipments/order-matches`, ({ request }) => {
      const ids = new URL(request.url).searchParams.getAll("order_id").map(Number)
      return HttpResponse.json({
        latest_sales_date: "2026-10-15",
        items: items.filter((m) => ids.includes(m.order_id)),
      })
    }),
  )
}

/** ハブの作業のボタン（aria-label は「① 送品済みにする 2注文」のように番号・見出し・件数） */
function getStep(name: RegExp): HTMLElement {
  return within(screen.getByRole("navigation", { name: "送品の消し込みの作業" })).getByRole(
    "button",
    { name },
  )
}

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

function mockMasters(): void {
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
}

describe("OrdersShippingPage のハブ（Issue #692）", () => {
  beforeEach(() => {
    window.location.hash = ""
    mockRole("order_handler")
    mockMasters()
  })

  it("①②③と日報の参考を片付ける順に並べ、件数に単位を付ける", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "YAYOI-DONE", desired_deadline: FUTURE }),
      makeOrder({ id: 2, order_no: "OVERDUE", desired_deadline: PAST }),
      makeOrder({ id: 3, order_no: "SOON", desired_deadline: addDaysToIsoDate(jstTodayIso(), 3) }),
      makeOrder({ id: 4, order_no: "NOT-YET", desired_deadline: FUTURE }),
    ])
    mockProgress([])
    mockMatches([makeMatch({ order_id: 1 })])
    mockUnmatched([
      makeUnmatched({ status: "no_order", product_code: "X1" }),
      makeUnmatched({ status: "no_order", product_code: "X2" }),
    ])
    mockOrderReviews([makeReview({ order_id: 1 })])
    render(<OrdersShippingPage />)

    expect(await screen.findByRole("button", { name: "① 送品済みにする 1注文" })).toBeInTheDocument()
    expect(getStep(/^② 出荷を確かめる 2注文$/)).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "③ 受注を起票する 2商品" })).toBeInTheDocument()
    expect(
      await screen.findByRole("button", {
        name: "日報が未入力の出荷済み注文 1注文",
      }),
    ).toBeInTheDocument()
    // 並びは ① → ② → ③ → 参考
    const nav = screen.getByRole("navigation", { name: "送品の消し込みの作業" })
    expect(
      within(nav)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")?.split(" ")[0]),
    ).toEqual(["①", "②", "③", "日報が未入力の出荷済み注文"])
    // 既定は①の一覧を出す
    expect(getStep(/^①/)).toHaveAttribute("aria-pressed", "true")
    expect(getBodyRows().map((r) => within(r).getAllByRole("link")[0].textContent)).toEqual([
      "YAYOI-DONE",
    ])
  })

  it("件数が0の作業は消さずに済みと出す", async () => {
    mockOrders([])
    mockProgress([])
    render(<OrdersShippingPage />)

    expect(await screen.findByRole("button", { name: "① 送品済みにする 済み" })).toBeInTheDocument()
    expect(getStep(/^② 出荷を確かめる 済み$/)).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "③ 受注を起票する 済み" })).toBeInTheDocument()
    expect(screen.getAllByText("済み")).toHaveLength(3)
    expect(await screen.findByText("送品済みにする注文はありません")).toBeInTheDocument()
  })

  it("弥生の明細の取得に失敗したら③を取得できなかったと出し、前提も出せない旨を出す", async () => {
    mockOrders([])
    mockProgress([])
    server.use(
      http.get(`${API_BASE}/shipments/unmatched-entries`, () =>
        HttpResponse.json({ detail: "error" }, { status: 500 }),
      ),
    )
    render(<OrdersShippingPage />)

    expect(
      await screen.findByRole("button", { name: "③ 受注を起票する 取得できませんでした" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("弥生の明細を取得できませんでした")
  })

  it("弥生の送品の取得に失敗したら①②の件数を出さない", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1", desired_deadline: PAST })])
    mockProgress([])
    server.use(
      http.get(`${API_BASE}/shipments/order-matches`, () =>
        HttpResponse.json({ detail: "error" }, { status: 500 }),
      ),
    )
    render(<OrdersShippingPage />)

    expect(
      await screen.findByRole("button", { name: "① 送品済みにする 取得できませんでした" }),
    ).toBeInTheDocument()
    expect(getStep(/^② 出荷を確かめる 取得できませんでした$/)).toBeInTheDocument()
    expect(screen.getByText("弥生の送品を取得できませんでした")).toBeInTheDocument()
  })

  it("作業を選ぶとハッシュに残して、その一覧だけを出す", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "YAYOI-DONE" }),
      makeOrder({ id: 2, order_no: "OVERDUE", desired_deadline: PAST }),
    ])
    mockProgress([])
    mockMatches([makeMatch({ order_id: 1 })])
    const user = userEvent.setup()
    render(<OrdersShippingPage />)

    await waitFor(() => getRow("YAYOI-DONE"))
    await user.click(getStep(/^②/))

    expect(window.location.hash).toBe("#confirm")
    expect(await screen.findByRole("link", { name: "OVERDUE" })).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "YAYOI-DONE" })).toBeNull()
    expect(screen.getByRole("region", { name: "② 出荷を確かめる" })).toBeInTheDocument()
  })

  it.each(["#candidates", "#review", "#unknown"])(
    "#682 のカードのハッシュ・知らないハッシュ（%s）で開いてもハブと①の一覧を出す",
    async (hash) => {
      window.location.hash = hash
      mockOrders([])
      mockProgress([])
      render(<OrdersShippingPage />)

      expect(await screen.findByRole("navigation", { name: "送品の消し込みの作業" })).toBeInTheDocument()
      expect(getStep(/^①/)).toHaveAttribute("aria-pressed", "true")
      expect(screen.getByRole("region", { name: "① 送品済みにする" })).toBeInTheDocument()
    },
  )

  it("画面に内部の言葉・仕組みの説明を出さない（docs/ui-writing-guidelines.md）", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "YAYOI-DONE" }),
      makeOrder({ id: 2, order_no: "OVERDUE", desired_deadline: PAST }),
    ])
    mockProgress([])
    mockMatches([
      makeMatch({ order_id: 1 }),
      makeMatch({
        order_id: 2,
        shipped_qty: 3,
        is_fully_shipped: false,
        ambiguous_entries: [makeEntry(4, 5, [2, 9])],
      }),
    ])
    mockUnmatched([
      makeUnmatched({ status: "unmatched_customer", customer_code: "009" }),
      makeUnmatched({ status: "unmatched_product", product_code: "P1", customer_ids: [1] }),
      makeUnmatched({ status: "no_order", product_code: "X3", customer_ids: [1], product_ids: [101] }),
      makeUnmatched({ status: "ambiguous", product_code: "X9", candidate_order_ids: [2, 9] }),
    ])
    mockOrderReviews([makeReview({ order_id: 1, cause: "process_mismatch" })])
    render(<OrdersShippingPage />)

    await screen.findByRole("region", { name: "先に片付けること" })
    // 用語集の内部語と、否定形・因果の連鎖でシステムの振る舞いを説明する文
    const forbidden = /当た|照合|候補|追いついていない|起票漏れ|自動では|しません|件数が変わ/
    const panels: [string, string][] = [
      ["#ship", "① 送品済みにする"],
      ["#confirm", "② 出荷を確かめる"],
      ["#register", "③ 受注を起票する"],
      ["#ambiguous", "送り先の受注を確かめる"],
      ["#daily-reports", "日報が未入力の出荷済み注文"],
    ]
    for (const [hash, title] of panels) {
      window.location.hash = hash
      window.dispatchEvent(new HashChangeEvent("hashchange"))
      await screen.findByRole("region", { name: title })
      await waitFor(() => expect(screen.queryByText("読み込み中...")).toBeNull())
      expect(document.body.textContent).not.toMatch(forbidden)
    }
  })
})

describe("OrdersShippingPage の前提バナー（Issue #692）", () => {
  beforeEach(() => {
    window.location.hash = ""
    mockRole("order_handler")
    mockMasters()
    mockProgress([])
  })

  it("名寄せが済んでいない得意先・商品が無ければ出さない", async () => {
    mockOrders([])
    mockUnmatched([makeUnmatched({ status: "no_order" })])
    render(<OrdersShippingPage />)

    expect(await screen.findByRole("button", { name: "③ 受注を起票する 1商品" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "先に片付けること" })).toBeNull()
  })

  it("得意先は得意先の数・商品は (得意先, 商品コード) の数を1文で出し、名寄せの画面へ移る", async () => {
    mockOrders([])
    mockUnmatched([
      // 同じ得意先の別の商品は得意先1件と数える
      makeUnmatched({ status: "unmatched_customer", customer_code_key: "009", product_code: "A" }),
      makeUnmatched({ status: "unmatched_customer", customer_code_key: "009", product_code: "B" }),
      makeUnmatched({ status: "unmatched_product", product_code: "P1" }),
      makeUnmatched({ status: "unmatched_product", product_code: "P2" }),
    ])
    render(<OrdersShippingPage />)

    const banner = await screen.findByRole("region", { name: "先に片付けること" })
    expect(banner).toHaveTextContent("弥生の得意先1件・商品2件がアプリに未登録です")
    // 得意先が残っていれば得意先のタブを開く
    expect(within(banner).getByRole("link", { name: "名寄せする" })).toHaveAttribute(
      "href",
      "/orders/shipment-names#customers",
    )
    // 前提は①②③に数えない
    expect(screen.getByRole("button", { name: "③ 受注を起票する 済み" })).toBeInTheDocument()
  })

  it("未登録が商品だけなら商品のタブを開く", async () => {
    mockOrders([])
    mockUnmatched([makeUnmatched({ status: "unmatched_product", product_code: "P1" })])
    render(<OrdersShippingPage />)

    const banner = await screen.findByRole("region", { name: "先に片付けること" })
    expect(banner).toHaveTextContent("弥生の商品1件がアプリに未登録です")
    expect(within(banner).getByRole("link", { name: "名寄せする" })).toHaveAttribute(
      "href",
      "/orders/shipment-names#products",
    )
  })

  it("送り先の受注を決められない明細を並べ、確かめる一覧に受注を出す", async () => {
    mockOrders([
      makeOrder({ id: 11, order_no: "O-11", desired_deadline: "2026-10-20", customer_order_no: "PO-9" }),
      makeOrder({ id: 12, order_no: "O-12", desired_deadline: "2026-10-20", status: "shipped" }),
    ])
    mockUnmatched([
      makeUnmatched({
        status: "ambiguous",
        product_code: "X9",
        customer_ids: [1],
        product_ids: [101],
        candidate_order_ids: [11, 12],
      }),
    ])
    const user = userEvent.setup()
    render(<OrdersShippingPage />)

    const banner = await screen.findByRole("region", { name: "先に片付けること" })
    expect(banner).toHaveTextContent("送り先の受注を決められない明細があります（1商品）")
    expect(within(banner).queryByRole("link", { name: "名寄せする" })).toBeNull()
    await user.click(within(banner).getByRole("button", { name: "受注を確かめる" }))

    expect(window.location.hash).toBe("#ambiguous")
    const [row] = await screen.findAllByTestId("unmatched-shipment-row")
    expect(within(row).getByRole("link", { name: "O-11" })).toHaveAttribute("href", "/orders/11")
    expect(within(row).getByText(/注番 PO-9/)).toBeInTheDocument()
    expect(within(row).getByRole("link", { name: "O-12" })).toHaveAttribute("href", "/orders/12")
  })
})

describe("OrdersShippingPage の① 送品済みにする（Issue #557 / #692）", () => {
  beforeEach(() => {
    window.location.hash = "#ship"
    mockRole("order_handler")
    mockMasters()
  })

  it("弥生で受注数量の送品を確かめられた注文だけを出す", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "OVERDUE", desired_deadline: PAST }),
      makeOrder({ id: 2, order_no: "YAYOI-DONE", quantity: 100 }),
      makeOrder({ id: 3, order_no: "SHIPPED", status: "shipped" }),
    ])
    mockProgress([])
    mockMatches([
      makeMatch({
        order_id: 2,
        shipped_qty: 100,
        order_quantity: 100,
        entries: [makeEntry(1, 60), makeEntry(2, 40)],
      }),
    ])
    render(<OrdersShippingPage />)

    const done = await waitFor(() => getRow("YAYOI-DONE"))
    expect(getBodyRows()).toHaveLength(1)
    expect(within(done).getByText("/ 100", { exact: false })).toBeInTheDocument()
    // 全行に共通する理由（弥生で送品済み）は出さない
    expect(within(done).queryByText("弥生で送品済み")).toBeNull()
    expect(screen.queryByRole("columnheader", { name: "理由" })).toBeNull()
    expect(screen.getByText(/^弥生 .*売上分まで$/)).toBeInTheDocument()
  })

  it.each<MemberRole>(["order_handler", "president"])("%s は1件ずつ送品済みにできる", async (role) => {
    mockRole(role)
    const shipped = vi.fn()
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockProgress([])
    mockMatches([makeMatch({ order_id: 1 })])
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
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockProgress([])
    mockMatches([makeMatch({ order_id: 1 })])
    render(<OrdersShippingPage />)

    const row = await waitFor(() => getRow("O-1"))
    await waitFor(() => expect(within(row).getByText(/売上$/)).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(within(row).queryByRole("button", { name: "送品済みにする" })).toBeNull()
  })

  it("日報の実績が届いていない注文には原因を短く出し、送品済みにするは押せる", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockProgress([])
    mockMatches([makeMatch({ order_id: 1 })])
    mockOrderReviews([makeReview({ order_id: 1, cause: "no_routing", final_process_name: null })])
    render(<OrdersShippingPage />)

    const row = await waitFor(() => getRow("O-1"))
    expect(await within(row).findByRole("link", { name: "日報: 工程なし" })).toHaveAttribute(
      "href",
      "#daily-reports",
    )
    expect(await within(row).findByRole("button", { name: "送品済みにする" })).toBeEnabled()
  })
})

describe("OrdersShippingPage の② 出荷を確かめる（Issue #557 / #692）", () => {
  beforeEach(() => {
    window.location.hash = "#confirm"
    mockRole("order_handler")
    mockMasters()
  })

  it("最終工程完了かつ納期超過を先頭に納期の古い順で出し、どれにも当てはまらない注文は出さない", async () => {
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
  })

  it("理由と工程の進捗・納期の超過日数を出し、進捗の無い注文は「日報なし」と出す", async () => {
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

  it("分納の途中・送り先未定の明細を示し、操作の列を出さない", async () => {
    mockOrders([makeOrder({ id: 3, order_no: "YAYOI-PART", desired_deadline: PAST, quantity: 100 })])
    mockProgress([])
    mockMatches([
      makeMatch({
        order_id: 3,
        shipped_qty: 30,
        order_quantity: 100,
        is_fully_shipped: false,
        entries: [makeEntry(3, 30)],
        ambiguous_entries: [makeEntry(4, 5, [3, 9])],
      }),
    ])
    render(<OrdersShippingPage />)

    const part = await waitFor(() => getRow("YAYOI-PART"))
    expect(within(part).getByText("一部送品")).toBeInTheDocument()
    expect(within(part).getByText("送り先未定 1明細")).toBeInTheDocument()
    expect(screen.queryByRole("columnheader", { name: "操作" })).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(within(part).queryByRole("button", { name: "送品済みにする" })).toBeNull()
  })

  it("進捗の最終計算日時を JST で出す", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1", desired_deadline: PAST })])
    mockProgress([], "2099-10-01T01:05:00Z")
    render(<OrdersShippingPage />)

    expect(await screen.findByText("日報 99/10/1 10:05")).toBeInTheDocument()
  })
})

describe("OrdersShippingPage の③ 受注を起票する（Issue #682 / #692）", () => {
  beforeEach(() => {
    window.location.hash = "#register"
    mockRole("order_handler")
    mockMasters()
    mockOrders([])
    mockProgress([])
  })

  it("受注が無い明細だけを出し、行ごとに受注を起票するを置く", async () => {
    mockUnmatched([
      makeUnmatched({ status: "unmatched_customer", customer_name: "未登録商事" }),
      makeUnmatched({
        status: "no_order",
        product_code: "X3",
        customer_ids: [1],
        product_ids: [101],
        note_deadlines: ["2026-11-30"],
        entry_count: 2,
        total_qty: 120,
      }),
    ])
    render(<OrdersShippingPage />)

    const [row, ...rest] = await screen.findAllByTestId("unmatched-shipment-row")
    expect(rest).toHaveLength(0)
    expect(screen.queryByText("未登録商事")).toBeNull()
    expect(within(row).getByRole("link", { name: "受注を起票する" })).toHaveAttribute(
      "href",
      "/orders/new",
    )
    expect(within(row).getByText("架空")).toBeInTheDocument()
    expect(within(row).getByText("DW-1 - 品A")).toBeInTheDocument()
    expect(within(row).getByText(/11\/30/)).toBeInTheDocument()
    expect(within(row).getByText("2明細")).toBeInTheDocument()
    expect(within(row).getByText("120")).toBeInTheDocument()
  })

  it("受注が無い明細が無ければその旨を出す", async () => {
    render(<OrdersShippingPage />)

    expect(await screen.findByText("起票する受注はありません")).toBeInTheDocument()
  })
})

describe("OrdersShippingPage の日報の参考（Issue #683 / #692）", () => {
  beforeEach(() => {
    window.location.hash = "#daily-reports"
    mockRole("order_handler")
    mockMasters()
  })

  it("原因ごとの見出しの下に製品の単位でまとめ、展開で注文を出す", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "O-1", product_id: 101, quantity: 60 }),
      makeOrder({ id: 2, order_no: "O-2", product_id: 101, quantity: 40 }),
      makeOrder({ id: 3, order_no: "O-3", product_id: 102 }),
    ])
    mockProgress([])
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

    // 件数は注文の数
    expect(
      await screen.findByRole("button", { name: "日報が未入力の出荷済み注文 3注文" }),
    ).toBeInTheDocument()
    expect(
      await screen.findByRole("heading", { name: /工程名が日報と合わない\s*1製品/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: /日報の顧客先が違う／作り置き\s*1製品/ })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "工程マスタ未登録の実績を見る" })).toHaveAttribute(
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
  })

  it("日報の書き漏れには日報の名寄せへのリンクを出し、原因の説明はヘルプに置く", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockProgress([])
    mockOrderReviews([makeReview({ order_id: 1, cause: "missing_report" })])
    render(<OrdersShippingPage />)

    expect(
      await screen.findByRole("heading", { name: /日報の書き漏れ・取り込み漏れ/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "日報の名寄せをする" })).toHaveAttribute(
      "href",
      "/master/daily-report-names",
    )
    expect(screen.queryByText(/日報の名寄せが済んでいない明細も受注に充てられない/)).toBeNull()

    await userEvent.setup().click(screen.getByRole("button", { name: "ヘルプを開く" }))
    expect(
      await within(screen.getByRole("dialog")).findByText(
        /日報の名寄せが済んでいない明細も受注に充てられない/,
      ),
    ).toBeInTheDocument()
  })
})
