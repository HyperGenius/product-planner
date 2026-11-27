import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@/test-utils/render"
import {
  getPageHeading,
  makeOrder,
  makeUnmatched,
  mockMasters,
  mockOrders,
  mockProgress,
  mockRole,
  mockUnmatched,
} from "@/test-utils/shipping"
import ShippingAmbiguousPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/shipping",
}))

describe("送り先の受注を確かめる（Issue #692 / #693）", () => {
  beforeEach(() => {
    mockRole("order_handler")
    mockMasters()
    mockProgress([])
  })

  it("送り先を決められない明細だけを出し、弥生の備考と見比べる受注を並べる", async () => {
    mockOrders([
      makeOrder({ id: 11, order_no: "O-11", desired_deadline: "2026-10-20", customer_order_no: "PO-9" }),
      makeOrder({ id: 12, order_no: "O-12", desired_deadline: "2026-10-20", status: "shipped" }),
    ])
    mockUnmatched([
      makeUnmatched({ status: "no_order", product_code: "X1" }),
      makeUnmatched({
        status: "ambiguous",
        product_code: "X9",
        customer_ids: [1],
        product_ids: [101],
        candidate_order_ids: [11, 12],
        note_deadlines: ["2026-10-20"],
        latest_note: "10/20納期分 PO-8",
      }),
    ])
    render(<ShippingAmbiguousPage />)

    const [row, ...rest] = await screen.findAllByTestId("unmatched-shipment-row")
    expect(rest).toHaveLength(0)
    expect(getPageHeading()).toHaveTextContent("送り先の受注を確かめる1商品")
    expect(within(row).getByText("納期分 10/20")).toBeInTheDocument()
    expect(within(row).getByText("10/20納期分 PO-8")).toBeInTheDocument()
    expect(within(row).getByRole("link", { name: "O-11" })).toHaveAttribute("href", "/orders/11")
    expect(within(row).getByText(/注番 PO-9/)).toBeInTheDocument()
    expect(within(row).getByRole("link", { name: "O-12" })).toHaveAttribute("href", "/orders/12")
    // ここからは起票・送品しない
    expect(screen.queryByRole("link", { name: "受注を起票する" })).toBeNull()
    expect(screen.queryByRole("button", { name: "送品済みにする" })).toBeNull()
  })

  it("無ければその旨を出す", async () => {
    mockOrders([])
    render(<ShippingAmbiguousPage />)

    expect(await screen.findByText("送り先の受注を決められない明細はありません")).toBeInTheDocument()
  })
})
