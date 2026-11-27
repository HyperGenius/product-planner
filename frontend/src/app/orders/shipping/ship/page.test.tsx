import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { MemberRole } from "@/types/member"
import {
  PAST,
  getBodyRows,
  getPageHeading,
  getRow,
  makeEntry,
  makeMatch,
  makeOrder,
  makeReview,
  mockMasters,
  mockMatches,
  mockOrderReviews,
  mockOrders,
  mockProgress,
  mockRole,
} from "@/test-utils/shipping"
import ShippingShipPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/shipping/ship",
}))

describe("① 送品済みにする（Issue #557 / #693）", () => {
  beforeEach(() => {
    mockRole("order_handler")
    mockMasters()
  })

  it("弥生で受注数量の送品を確かめられた注文だけを出し、行数を見出しの件数とそろえる", async () => {
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
    render(<ShippingShipPage />)

    const done = await waitFor(() => getRow("YAYOI-DONE"))
    expect(getBodyRows()).toHaveLength(1)
    expect(getPageHeading()).toHaveTextContent("① 送品済みにする1注文")
    expect(within(done).getByText("/ 100", { exact: false })).toBeInTheDocument()
    expect(within(done).getByText("10/15 売上")).toBeInTheDocument()
    // 全行に共通する理由（弥生で送品済み）・工程の進捗の列は出さない
    expect(screen.queryByRole("columnheader", { name: "理由" })).toBeNull()
    expect(screen.queryByRole("columnheader", { name: "工程の進捗" })).toBeNull()
    expect(screen.getByRole("columnheader", { name: "受注数量" })).toBeInTheDocument()
    expect(screen.getByText(/^弥生 .*売上分まで$/)).toBeInTheDocument()
    // ハブへ戻れる
    expect(screen.getByRole("link", { name: "送品の消し込み" })).toHaveAttribute(
      "href",
      "/orders/shipping",
    )
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
    render(<ShippingShipPage />)

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
    render(<ShippingShipPage />)

    const row = await waitFor(() => getRow("O-1"))
    await waitFor(() => expect(within(row).getByText(/売上$/)).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(within(row).queryByRole("button", { name: "送品済みにする" })).toBeNull()
  })

  it("日報が未入力の注文には原因を短く出して日報のページへつなぎ、送品済みにするは押せる", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockProgress([])
    mockMatches([makeMatch({ order_id: 1 })])
    mockOrderReviews([makeReview({ order_id: 1, cause: "no_routing", final_process_name: null })])
    render(<ShippingShipPage />)

    const row = await waitFor(() => getRow("O-1"))
    expect(await within(row).findByRole("link", { name: "日報: 工程なし" })).toHaveAttribute(
      "href",
      "/orders/shipping/daily-reports",
    )
    expect(await within(row).findByRole("button", { name: "送品済みにする" })).toBeEnabled()
  })

  it("送り先未定の明細があれば件数を出し、確かめるページへつなぐ", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockProgress([])
    mockMatches([makeMatch({ order_id: 1, ambiguous_entries: [makeEntry(4, 5, [1, 9])] })])
    render(<ShippingShipPage />)

    const row = await waitFor(() => getRow("O-1"))
    expect(within(row).getByRole("link", { name: "送り先未定 1明細" })).toHaveAttribute(
      "href",
      "/orders/shipping/ambiguous",
    )
  })

  it("弥生の送品の取得に失敗したら一覧の代わりにその旨を出す", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockProgress([])
    server.use(
      http.get(`${API_BASE}/shipments/order-matches`, () =>
        HttpResponse.json({ detail: "error" }, { status: 500 }),
      ),
    )
    render(<ShippingShipPage />)

    expect(await screen.findByText("弥生の送品を取得できませんでした")).toBeInTheDocument()
    expect(getPageHeading()).toHaveTextContent("取得できませんでした")
  })

  it("対象が無ければその旨を出す", async () => {
    mockOrders([])
    mockProgress([])
    render(<ShippingShipPage />)

    expect(await screen.findByText("送品済みにする注文はありません")).toBeInTheDocument()
    expect(getPageHeading()).toHaveTextContent("0注文")
  })
})
