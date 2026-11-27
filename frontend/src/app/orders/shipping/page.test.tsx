import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { addDaysToIsoDate } from "@/lib/floor-dashboard-utils"
import { jstTodayIso } from "@/lib/order-utils"
import {
  FORBIDDEN_UI_TEXT,
  FUTURE,
  PAST,
  makeMatch,
  makeOrder,
  makeReview,
  makeUnmatched,
  mockMasters,
  mockMatches,
  mockOrderReviews,
  mockOrders,
  mockProgress,
  mockRole,
  mockUnmatched,
} from "@/test-utils/shipping"
import OrdersShippingPage from "./page"

const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/shipping",
}))

/** ハブの作業のリンク（aria-label は「① 送品済みにする 2注文」のように番号・見出し・件数） */
function getStep(name: RegExp): HTMLElement {
  return within(screen.getByRole("navigation", { name: "送品の消し込みの作業" })).getByRole(
    "link",
    { name },
  )
}

describe("OrdersShippingPage のハブ（Issue #692 / #693）", () => {
  beforeEach(() => {
    window.location.hash = ""
    replace.mockClear()
    mockRole("order_handler")
    mockMasters()
  })

  it("①②③と日報の参考を片付ける順に並べ、件数に単位を付けて各ページへ移る", async () => {
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

    expect(await screen.findByRole("link", { name: "① 送品済みにする 1注文" })).toHaveAttribute(
      "href",
      "/orders/shipping/ship",
    )
    expect(getStep(/^② 出荷を確かめる 2注文$/)).toHaveAttribute("href", "/orders/shipping/confirm")
    expect(await screen.findByRole("link", { name: "③ 受注を起票する 2商品" })).toHaveAttribute(
      "href",
      "/orders/shipping/register",
    )
    expect(
      await screen.findByRole("link", { name: "日報が未入力の出荷済み注文 1注文" }),
    ).toHaveAttribute("href", "/orders/shipping/daily-reports")
    // 並びは ① → ② → ③ → 参考
    const nav = screen.getByRole("navigation", { name: "送品の消し込みの作業" })
    expect(
      within(nav)
        .getAllByRole("link")
        .map((b) => b.getAttribute("aria-label")?.split(" ")[0]),
    ).toEqual(["①", "②", "③", "日報が未入力の出荷済み注文"])
    // ハブには一覧を出さない（各ページに移した）
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("件数が0の作業は消さずに済みと出す", async () => {
    mockOrders([])
    mockProgress([])
    render(<OrdersShippingPage />)

    expect(await screen.findByRole("link", { name: "① 送品済みにする 済み" })).toBeInTheDocument()
    expect(getStep(/^② 出荷を確かめる 済み$/)).toBeInTheDocument()
    expect(await screen.findByRole("link", { name: "③ 受注を起票する 済み" })).toBeInTheDocument()
    expect(screen.getAllByText("済み")).toHaveLength(3)
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
      await screen.findByRole("link", { name: "③ 受注を起票する 取得できませんでした" }),
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
      await screen.findByRole("link", { name: "① 送品済みにする 取得できませんでした" }),
    ).toBeInTheDocument()
    expect(getStep(/^② 出荷を確かめる 取得できませんでした$/)).toBeInTheDocument()
    expect(screen.getByText("弥生 取得できませんでした")).toBeInTheDocument()
  })

  it.each([
    ["#ship", "/orders/shipping/ship"],
    ["#confirm", "/orders/shipping/confirm"],
    ["#register", "/orders/shipping/register"],
    ["#ambiguous", "/orders/shipping/ambiguous"],
    ["#daily-reports", "/orders/shipping/daily-reports"],
    ["#candidates", "/orders/shipping/ship"],
  ])("古いハッシュ（%s）で開いたらそのページへ移る", async (hash, href) => {
    window.location.hash = hash
    mockOrders([])
    mockProgress([])
    render(<OrdersShippingPage />)

    await waitFor(() => expect(replace).toHaveBeenCalledWith(href))
  })

  it.each(["#review", "#unknown"])("#682 の要確認・知らないハッシュ（%s）ではハブを出す", async (hash) => {
    window.location.hash = hash
    mockOrders([])
    mockProgress([])
    render(<OrdersShippingPage />)

    expect(await screen.findByRole("navigation", { name: "送品の消し込みの作業" })).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  it("画面に内部の言葉・仕組みの説明を出さない（docs/ui-writing-guidelines.md）", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "YAYOI-DONE" })])
    mockProgress([])
    mockMatches([makeMatch({ order_id: 1 })])
    mockUnmatched([
      makeUnmatched({ status: "unmatched_customer", customer_code: "009" }),
      makeUnmatched({ status: "unmatched_product", product_code: "P1", customer_ids: [1] }),
      makeUnmatched({ status: "ambiguous", product_code: "X9", candidate_order_ids: [1, 9] }),
    ])
    render(<OrdersShippingPage />)

    await screen.findByRole("region", { name: "先に片付けること" })
    expect(document.body.textContent).not.toMatch(FORBIDDEN_UI_TEXT)
  })
})

describe("OrdersShippingPage の前提バナー（Issue #692 / #693）", () => {
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

    expect(await screen.findByRole("link", { name: "③ 受注を起票する 1商品" })).toBeInTheDocument()
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
    expect(screen.getByRole("link", { name: "③ 受注を起票する 済み" })).toBeInTheDocument()
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

  it("送り先の受注を決められない明細があれば、確かめるページへ移るリンクを出す", async () => {
    mockOrders([])
    mockUnmatched([makeUnmatched({ status: "ambiguous", candidate_order_ids: [11, 12] })])
    render(<OrdersShippingPage />)

    const banner = await screen.findByRole("region", { name: "先に片付けること" })
    expect(banner).toHaveTextContent("送り先の受注を決められない明細があります（1商品）")
    expect(within(banner).queryByRole("link", { name: "名寄せする" })).toBeNull()
    expect(within(banner).getByRole("link", { name: "受注を確かめる" })).toHaveAttribute(
      "href",
      "/orders/shipping/ambiguous",
    )
  })
})
