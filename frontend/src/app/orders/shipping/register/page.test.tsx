import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@/test-utils/render"
import {
  getPageHeading,
  makeUnmatched,
  mockMasters,
  mockOrders,
  mockProgress,
  mockRole,
  mockUnmatched,
} from "@/test-utils/shipping"
import ShippingRegisterPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/shipping",
}))

describe("③ 受注を起票する（Issue #682 / #693）", () => {
  beforeEach(() => {
    mockRole("order_handler")
    mockMasters()
    mockOrders([])
    mockProgress([])
  })

  it("受注が無い明細だけを出し、起票に要る顧客・品名・納期分を列に並べ、行ごとに受注を起票するを置く", async () => {
    mockUnmatched([
      makeUnmatched({ status: "unmatched_customer", customer_name: "未登録商事" }),
      makeUnmatched({ status: "ambiguous", product_code: "X9", candidate_order_ids: [1, 2] }),
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
    render(<ShippingRegisterPage />)

    const [row, ...rest] = await screen.findAllByTestId("unmatched-shipment-row")
    expect(rest).toHaveLength(0)
    expect(getPageHeading()).toHaveTextContent("③ 受注を起票する1商品")
    expect(screen.queryByText("未登録商事")).toBeNull()
    // 行の顧客・製品・数量・納期分を初期値にして受注作成を開き、作成したら③へ戻る（#694）
    const href = within(row).getByRole("link", { name: "受注を起票する" }).getAttribute("href")!
    const url = new URL(href, "http://localhost")
    expect(url.pathname).toBe("/orders/new")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      customer_id: "1",
      product_id: "101",
      quantity: "120",
      desired_deadline: "2026-11-30",
      return_to: "/orders/shipping/register",
    })
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent),
    ).toEqual(["得意先（弥生）", "顧客", "品名", "数量", "最後の売上日", "備考の納期分", "操作"])
    expect(within(row).getByText("架空")).toBeInTheDocument()
    expect(within(row).getByText("DW-1 - 品A")).toBeInTheDocument()
    expect(within(row).getByText("11/30")).toBeInTheDocument()
    expect(within(row).getByText("2明細")).toBeInTheDocument()
    expect(within(row).getByText("120")).toBeInTheDocument()
  })

  it("顧客・製品・納期分が1つに決まらない値は初期値にしない", async () => {
    mockUnmatched([
      makeUnmatched({
        status: "no_order",
        customer_ids: [1, 2],
        product_ids: [],
        note_deadlines: ["2026-11-20", "2026-11-30"],
        total_qty: 0,
      }),
    ])
    render(<ShippingRegisterPage />)

    const [row] = await screen.findAllByTestId("unmatched-shipment-row")
    expect(within(row).getByRole("link", { name: "受注を起票する" })).toHaveAttribute(
      "href",
      "/orders/new?return_to=%2Forders%2Fshipping%2Fregister",
    )
  })

  it("受注が無い明細が無ければその旨を出す", async () => {
    render(<ShippingRegisterPage />)

    expect(await screen.findByText("起票する受注はありません")).toBeInTheDocument()
    expect(getPageHeading()).toHaveTextContent("0商品")
  })

  it("一覧が上限で切られていたら件数に「以上」と付ける", async () => {
    mockUnmatched([makeUnmatched({ status: "no_order" })], { truncated: true })
    render(<ShippingRegisterPage />)

    await screen.findAllByTestId("unmatched-shipment-row")
    expect(getPageHeading()).toHaveTextContent("1商品以上")
  })
})
