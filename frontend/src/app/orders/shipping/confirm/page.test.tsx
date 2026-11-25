import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@/test-utils/render"
import { addDaysToIsoDate } from "@/lib/floor-dashboard-utils"
import { jstTodayIso } from "@/lib/order-utils"
import {
  FUTURE,
  PAST,
  getBodyRows,
  getPageHeading,
  getRow,
  makeEntry,
  makeMatch,
  makeOrder,
  makeProcess,
  makeReview,
  mockMasters,
  mockMatches,
  mockOrderReviews,
  mockOrders,
  mockProgress,
  mockRole,
} from "@/test-utils/shipping"
import ShippingConfirmPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/shipping/confirm",
}))

function orderNos(): (string | null)[] {
  return getBodyRows().map((r) => within(r).getAllByRole("link")[0].textContent)
}

describe("② 出荷を確かめる（Issue #557 / #693）", () => {
  beforeEach(() => {
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
    render(<ShippingConfirmPage />)

    await screen.findByRole("link", { name: "DONE-OVERDUE" })
    // 進捗は対象（確定済・生産中）の注文だけをまとめて引く
    expect(requested).toEqual([[1, 2, 3, 4, 5]])
    expect(orderNos()).toEqual(["DONE-OVERDUE", "OVERDUE", "SOON", "DONE"])
    expect(getPageHeading()).toHaveTextContent("② 出荷を確かめる4注文")
    expect(screen.queryByText("NOT-YET")).toBeNull()
    expect(screen.queryByText("SHIPPED")).toBeNull()
    expect(screen.queryByText("DRAFT")).toBeNull()
  })

  it("理由を行ごとに出し、進捗の無い注文は「日報なし」と出す", async () => {
    const soon = addDaysToIsoDate(jstTodayIso(), 3)
    mockOrders([
      makeOrder({ id: 1, order_no: "DONE-OVERDUE", desired_deadline: PAST }),
      makeOrder({ id: 2, order_no: "NO-REPORT", desired_deadline: undefined, confirmed_deadline: PAST }),
      makeOrder({ id: 3, order_no: "SOON", desired_deadline: soon }),
    ])
    mockProgress([
      makeProcess({ order_id: 1, process_routing_id: 1, sequence_order: 1, status: "completed", completed_by: "later_process" }),
      makeProcess({ order_id: 1, process_routing_id: 2, sequence_order: 2, status: "completed", completed_by: "quantity" }),
    ])
    render(<ShippingConfirmPage />)

    const done = await waitFor(() => getRow("DONE-OVERDUE"))
    expect(within(done).getByText("最終工程が完了")).toBeInTheDocument()
    expect(within(done).getByText(/^納期を\d+日過ぎた$/)).toBeInTheDocument()
    expect(within(done).getByText("2 / 2")).toBeInTheDocument()

    const noReport = getRow("NO-REPORT")
    expect(within(noReport).getByText("日報なし")).toBeInTheDocument()
    expect(within(noReport).queryByText("最終工程が完了")).toBeNull()
    // 希望納期が無いので完成見込み（確定納期）で判定している
    expect(within(noReport).getByText("（完成見込み）")).toBeInTheDocument()

    expect(within(getRow("SOON")).getByText("納期まで3日")).toBeInTheDocument()
  })

  it("分納の途中・送り先未定の明細・日報の漏れを示し、操作の列を出さない", async () => {
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
    mockOrderReviews([makeReview({ order_id: 3, cause: "customer_or_stock" })])
    render(<ShippingConfirmPage />)

    const part = await waitFor(() => getRow("YAYOI-PART"))
    expect(within(part).getByText("一部送品")).toBeInTheDocument()
    expect(within(part).getByRole("link", { name: "送り先未定 1明細" })).toHaveAttribute(
      "href",
      "/orders/shipping/ambiguous",
    )
    expect(
      await within(part).findByRole("link", { name: "日報: 顧客先違い・作り置き" }),
    ).toHaveAttribute("href", "/orders/shipping/daily-reports")
    expect(screen.queryByRole("columnheader", { name: "操作" })).toBeNull()
    expect(within(part).queryByRole("button", { name: "送品済みにする" })).toBeNull()
  })

  it("弥生に計上が無い注文は、納期が最新の売上日より後なら取り込み待ちとして後ろへ回し、それ以外は未計上と出す", async () => {
    mockOrders([
      // 最終工程完了かつ納期超過で分類の並びでは先頭だが、納期が最新の売上日（3/15）より後で弥生に計上なし → 取り込み待ち
      makeOrder({ id: 1, order_no: "WAITING", desired_deadline: "2000-04-01" }),
      // 納期が最新の売上日以前で、弥生に計上なし → 未計上
      makeOrder({ id: 2, order_no: "MISSING", desired_deadline: "2000-03-01" }),
    ])
    mockProgress([makeProcess({ order_id: 1, status: "completed", completed_by: "quantity" })])
    mockMatches([], "2000-03-15")
    render(<ShippingConfirmPage />)

    await waitFor(() => expect(within(getRow("WAITING")).getByText("取り込み待ち")).toBeInTheDocument())
    expect(within(getRow("MISSING")).getByText("未計上")).toBeInTheDocument()
    expect(orderNos()).toEqual(["MISSING", "WAITING"])
    // 並べ替えだけで、行数は見出しの件数と一致する
    expect(getPageHeading()).toHaveTextContent("2注文")
  })
})
