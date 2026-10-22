import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { MemberRole } from "@/types/member"
import type { EmailIntakeResult, Order } from "@/types/order"
import OrdersIntakePage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/intake",
}))

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: "2099-09-30",
    status: "draft",
    customer_certainty: null,
    is_scheduled: false,
    has_no_routings: false,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function makeEmailResult(overrides: Partial<EmailIntakeResult>): EmailIntakeResult {
  return {
    id: "att-1",
    received_at: new Date().toISOString(),
    customer_id: null,
    customer_name: null,
    original_filename: "order.pdf",
    has_attachment: true,
    content_type: "application/pdf",
    parse_status: "failed_image",
    gmail_message_id: null,
    gmail_url: null,
    signed_url: null,
    created_order_count: 0,
    created_order_ids: [],
    parse_log_reasons: [],
    outcome: "failed",
    needs_attention: false,
    empty_draft: false,
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

function mockEmailResults(results: EmailIntakeResult[]): void {
  server.use(
    http.get(`${API_BASE}/orders/email-intake-results`, () => HttpResponse.json(results)),
  )
}

function getSection(name: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${name}`) })
}

const ordersOfAllCategories: Order[] = [
  makeOrder({ id: 1, order_no: "NO-PRODUCT", product_id: null, has_no_routings: true }),
  makeOrder({ id: 2, order_no: "NO-ROUTING", has_no_routings: true }),
  makeOrder({ id: 3, order_no: "INCOMPLETE", customer_id: undefined }),
  makeOrder({ id: 4, order_no: "UNSIMULATED" }),
  makeOrder({ id: 5, order_no: "SIMULATED", is_scheduled: true, simulated_deadline: "2099-09-20" }),
  makeOrder({
    id: 6,
    order_no: "REPAIR",
    order_type: "repair",
    product_id: null,
    quantity: null,
    has_no_routings: true,
  }),
  makeOrder({ id: 7, order_no: "PENDING", status: "pending_approval", is_scheduled: true }),
  makeOrder({ id: 8, order_no: "CONFIRMED", status: "confirmed", is_scheduled: true }),
]

describe("OrdersIntakePage（Issue #555）", () => {
  beforeEach(() => {
    mockRole("order_handler")
    mockEmailResults([])
  })

  it("下書きを5区分のいずれか1つにだけ出し、下書き以外は出さない", async () => {
    mockOrders(ordersOfAllCategories)
    render(<OrdersIntakePage />)

    await screen.findByRole("region", { name: /^製品未確定/ })
    const expected: Record<string, string[]> = {
      製品未確定: ["NO-PRODUCT"],
      工程未登録: ["NO-ROUTING"],
      情報不足: ["INCOMPLETE"],
      // 修理注文は製品・工程を持たないので製品未確定・工程未登録に入れない
      シミュ未実行: ["UNSIMULATED", "REPAIR"],
      シミュ納期の確認: ["SIMULATED"],
    }
    for (const [name, orderNos] of Object.entries(expected)) {
      const section = getSection(name)
      // 見出し行を除いた行数が区分の件数と一致する（他の区分の注文が混ざらない）
      expect(within(section).getAllByRole("row")).toHaveLength(orderNos.length + 1)
      for (const orderNo of orderNos) {
        expect(within(section).getByText(orderNo)).toBeInTheDocument()
      }
    }
    expect(screen.getAllByText("REPAIR")).toHaveLength(1)
    expect(screen.queryByText("PENDING")).not.toBeInTheDocument()
    expect(screen.queryByText("CONFIRMED")).not.toBeInTheDocument()

    // 件数カード
    expect(screen.getByRole("link", { name: "シミュ未実行 2件" })).toHaveAttribute(
      "href",
      "#intake-unsimulated",
    )
  })

  it("区分ごとに次の操作を出す", async () => {
    mockOrders(ordersOfAllCategories)
    render(<OrdersIntakePage />)

    const noProduct = await screen.findByRole("region", { name: /^製品未確定/ })
    expect(within(noProduct).getByRole("button", { name: "製品を選ぶ" })).toBeInTheDocument()
    expect(within(noProduct).getByRole("link", { name: "製品マスタに登録" })).toHaveAttribute(
      "href",
      "/master/products",
    )
    // 製品が無いのでシミュは出さない
    expect(within(noProduct).queryByRole("button", { name: "シミュレーション実行" })).toBeNull()

    expect(within(getSection("工程未登録")).getByRole("link", { name: "工程を登録" })).toHaveAttribute(
      "href",
      "/master/products?highlight=1",
    )
    expect(within(getSection("情報不足")).getByRole("button", { name: "編集" })).toBeInTheDocument()

    const unsimulated = getSection("シミュ未実行")
    expect(within(unsimulated).getAllByRole("button", { name: "シミュレーション実行" })).toHaveLength(2)
    expect(within(unsimulated).getByRole("checkbox", { name: "シミュ未実行をすべて選択" })).toBeInTheDocument()

    const simulated = getSection("シミュ納期の確認")
    expect(within(simulated).getByRole("button", { name: "承認依頼を送信" })).toBeInTheDocument()
    // 一括操作の対象にしない区分には選択欄を出さない
    expect(within(noProduct).queryByRole("checkbox")).toBeNull()
  })

  it("差し戻された下書きは区分を変えず、差し戻しバッジと理由を出す", async () => {
    mockOrders([
      makeOrder({
        id: 5,
        order_no: "REJECTED",
        is_scheduled: true,
        rejection_reason: "納期を確認してください",
      }),
    ])
    render(<OrdersIntakePage />)

    const simulated = await screen.findByRole("region", { name: /^シミュ納期の確認/ })
    expect(within(simulated).getByText("REJECTED")).toBeInTheDocument()
    expect(within(simulated).getByText("差し戻し")).toBeInTheDocument()
    expect(within(simulated).getByText("納期を確認してください")).toBeInTheDocument()
  })

  it("承認依頼を出した注文は画面から外れる", async () => {
    let orders = [makeOrder({ id: 5, order_no: "SIMULATED", is_scheduled: true })]
    server.use(
      http.get(`${API_BASE}/orders`, () => HttpResponse.json(orders)),
      http.post(`${API_BASE}/orders/5/request-approval`, () => {
        orders = orders.map((o) => ({ ...o, status: "pending_approval" as const }))
        return HttpResponse.json(orders[0])
      }),
    )
    const user = userEvent.setup()
    render(<OrdersIntakePage />)

    await user.click(await screen.findByRole("button", { name: "承認依頼を送信" }))
    await user.click(await screen.findByRole("button", { name: "承認依頼を送信する" }))
    await user.click(await screen.findByRole("button", { name: "閉じる" }))

    await waitFor(() => expect(screen.queryByText("SIMULATED")).not.toBeInTheDocument())
    expect(screen.getByText("確認待ちの下書きはありません")).toBeInTheDocument()
  })

  it("直近7日に起票に失敗したメールの件数と受信メール処理結果へのリンクを出す", async () => {
    mockOrders([])
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    mockEmailResults([
      makeEmailResult({ id: "a" }),
      makeEmailResult({ id: "b" }),
      makeEmailResult({ id: "c", received_at: eightDaysAgo }),
      makeEmailResult({ id: "d", outcome: "created" }),
    ])
    render(<OrdersIntakePage />)

    const notice = await screen.findByRole("status")
    expect(notice).toHaveTextContent("直近7日に受信したメールのうち2件が起票に失敗しています")
    expect(within(notice).getByRole("link", { name: /受信メール処理結果を見る/ })).toHaveAttribute(
      "href",
      "/orders/email-intake",
    )
  })

  it("起票に失敗したメールが無くても受信メール処理結果へのリンクは置く", async () => {
    mockOrders([])
    render(<OrdersIntakePage />)

    expect(await screen.findByText("確認待ちの下書きはありません")).toBeInTheDocument()
    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByRole("link", { name: "受信メール処理結果を見る" })).toHaveAttribute(
      "href",
      "/orders/email-intake",
    )
  })

  it("納期超過の下書きの一括送品は社長・プラットフォーム管理者にだけ出す", async () => {
    mockOrders([makeOrder({ id: 4, order_no: "OVERDUE", desired_deadline: "2020-01-01" })])
    mockRole("president")
    const user = userEvent.setup()
    render(<OrdersIntakePage />)

    await user.click(await screen.findByRole("button", { name: "その他の操作" }))
    expect(
      await screen.findByRole("menuitem", { name: "納期超過の下書きを送品済みにする（1件）" }),
    ).toBeInTheDocument()
  })

  it("受注担当には納期超過の下書きの一括送品を出さない", async () => {
    mockOrders([makeOrder({ id: 4, order_no: "OVERDUE", desired_deadline: "2020-01-01" })])
    render(<OrdersIntakePage />)

    await screen.findByText("OVERDUE")
    expect(screen.queryByRole("button", { name: "その他の操作" })).toBeNull()
  })
})
