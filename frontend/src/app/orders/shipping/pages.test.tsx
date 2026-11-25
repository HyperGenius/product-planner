import type { ComponentType } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@/test-utils/render"
import {
  FORBIDDEN_UI_TEXT,
  PAST,
  makeEntry,
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
import ShippingAmbiguousPage from "./ambiguous/page"
import ShippingConfirmPage from "./confirm/page"
import ShippingDailyReportsPage from "./daily-reports/page"
import ShippingRegisterPage from "./register/page"
import ShippingShipPage from "./ship/page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/shipping",
}))

/**
 * 送品の消し込みの各ページ（Issue #693）に共通する決まり。
 * - 「送品済みにする」は①にだけ置く
 * - 画面に内部の言葉・仕組みの説明を出さない（docs/ui-writing-guidelines.md）
 * - ハブへ戻れる
 */
const PAGES: [string, ComponentType, boolean][] = [
  ["① 送品済みにする", ShippingShipPage, true],
  ["② 出荷を確かめる", ShippingConfirmPage, false],
  ["③ 受注を起票する", ShippingRegisterPage, false],
  ["送り先の受注を確かめる", ShippingAmbiguousPage, false],
  ["日報が未入力の出荷済み注文", ShippingDailyReportsPage, false],
]

describe("送品の消し込みの各ページ（Issue #693）", () => {
  beforeEach(() => {
    mockRole("order_handler")
    mockMasters()
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
      makeUnmatched({ status: "no_order", product_code: "X3", customer_ids: [1], product_ids: [101] }),
      makeUnmatched({ status: "ambiguous", product_code: "X9", candidate_order_ids: [2, 9] }),
    ])
    mockOrderReviews([
      makeReview({ order_id: 1, cause: "process_mismatch" }),
      makeReview({ order_id: 2, cause: "missing_report" }),
    ])
  })

  it.each(PAGES)("%s: 文言・操作・戻り先", async (title, Page, hasShip) => {
    render(<Page />)

    const heading = screen.getByRole("heading", { level: 1 })
    expect(heading).toHaveTextContent(title)
    // 件数が出そろい、一覧が描画されるまで待つ
    await waitFor(() => expect(heading).toHaveTextContent(/\d+(注文|商品)/))
    await waitFor(() => expect(screen.queryByText("読み込み中...")).toBeNull())
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1))

    expect(screen.getByRole("link", { name: "送品の消し込み" })).toHaveAttribute("href", "/orders/shipping")
    expect(document.body.textContent).not.toMatch(FORBIDDEN_UI_TEXT)
    if (hasShip) {
      expect(await screen.findAllByRole("button", { name: "送品済みにする" })).not.toHaveLength(0)
    } else {
      expect(screen.queryByRole("button", { name: "送品済みにする" })).toBeNull()
    }
  })
})
