import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, userEvent, within } from "@/test-utils/render"
import {
  getPageHeading,
  makeOrder,
  makeReview,
  mockMasters,
  mockOrderReviews,
  mockOrders,
  mockProgress,
  mockRole,
} from "@/test-utils/shipping"
import ShippingDailyReportsPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/shipping",
}))

describe("日報が未入力の出荷済み注文（Issue #683 / #693）", () => {
  beforeEach(() => {
    mockRole("order_handler")
    mockMasters()
    mockProgress([])
  })

  it("原因ごとの見出しの下に製品の単位でまとめ、展開で注文を出す", async () => {
    mockOrders([
      makeOrder({ id: 1, order_no: "O-1", product_id: 101, quantity: 60 }),
      makeOrder({ id: 2, order_no: "O-2", product_id: 101, quantity: 40 }),
      makeOrder({ id: 3, order_no: "O-3", product_id: 102 }),
    ])
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
      // 送品の消し込みの対象（確定済・生産中）でない注文は数えない
      makeReview({ order_id: 99, product_id: 102, cause: "missing_report" }),
    ])
    const user = userEvent.setup()
    render(<ShippingDailyReportsPage />)

    expect(
      await screen.findByRole("heading", { name: /工程名が日報と合わない\s*1製品/ }),
    ).toBeInTheDocument()
    // 件数は注文の数で、ハブと同じ
    expect(getPageHeading()).toHaveTextContent("日報が未入力の出荷済み注文3注文")
    expect(screen.getByRole("heading", { name: /日報の顧客先が違う／作り置き\s*1製品/ })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: /日報の書き漏れ/ })).toBeNull()
    expect(screen.getByRole("link", { name: "製品の工程を日報に合わせる" })).toHaveAttribute(
      "href",
      "/master/daily-reports/processes",
    )

    const [mismatch, stock] = screen.getAllByTestId("order-review-product-row")
    expect(within(mismatch).getByText("DW-1 - 品A")).toBeInTheDocument()
    expect(within(mismatch).getByText("100")).toBeInTheDocument()
    expect(within(mismatch).getByRole("link", { name: "製品マスタで工程を開く" })).toHaveAttribute(
      "href",
      "/master/products?highlight=101",
    )
    expect(screen.queryByTestId("order-review-order-row")).toBeNull()

    await user.click(within(mismatch).getByRole("button", { name: "2件の注文" }))
    expect(
      screen.getAllByTestId("order-review-order-row").map((r) => within(r).getAllByRole("link")[0].textContent),
    ).toEqual(["O-1", "O-2"])

    await user.click(within(stock).getByRole("button", { name: "1件の注文" }))
    expect(screen.getByRole("link", { name: "受注詳細で作り置きを引き当てる" })).toHaveAttribute(
      "href",
      "/orders/3",
    )
    // 送品済みにする操作は無い
    expect(screen.queryByRole("button", { name: "送品済みにする" })).toBeNull()
  })

  it("日報の書き漏れには日報の実績へのリンクを出し、原因の説明はヘルプに置く", async () => {
    mockOrders([makeOrder({ id: 1, order_no: "O-1" })])
    mockOrderReviews([makeReview({ order_id: 1, cause: "missing_report" })])
    render(<ShippingDailyReportsPage />)

    expect(
      await screen.findByRole("heading", { name: /日報の書き漏れ・取り込み漏れ/ }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "日報の実績を確かめる" })).toHaveAttribute(
      "href",
      "/master/daily-reports",
    )
    expect(screen.queryByText(/日報の顧客先・製品がアプリに結び付いていない明細も受注に充てられない/)).toBeNull()

    await userEvent.setup().click(screen.getByRole("button", { name: "ヘルプを開く" }))
    expect(
      await within(screen.getByRole("dialog")).findByText(
        /日報の顧客先・製品がアプリに結び付いていない明細も受注に充てられない/,
      ),
    ).toBeInTheDocument()
  })
})
