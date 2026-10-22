import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { SidebarProvider } from "@/components/ui/sidebar"
import type { MemberRole } from "@/types/member"
import type { Order } from "@/types/order"
import { AppSidebar } from "./app-sidebar"

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock("@/lib/auth-server-actions", () => ({ logout: vi.fn() }))

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
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

function setup(role: MemberRole) {
  const fetchedOrders = vi.fn()
  const fetchedProgress = vi.fn()
  server.use(
    http.get(`${API_BASE}/daily-reports/order-progress`, () => {
      fetchedProgress()
      // 注文6は最終工程が完了（送品の候補）、注文7は進行中（納期も先なので候補でない）
      return HttpResponse.json({
        computed_at: "2099-10-01T00:00:00Z",
        items: [
          { order_id: 6, process_routing_id: 1, sequence_order: 1, process_name: "プレス", good_qty: 10, order_quantity: 10, first_actual_date: null, last_actual_date: null, status: "completed", completed_by: "quantity", planned_end_datetime: null },
          { order_id: 7, process_routing_id: 1, sequence_order: 1, process_name: "プレス", good_qty: 1, order_quantity: 10, first_actual_date: null, last_actual_date: null, status: "in_progress", completed_by: null, planned_end_datetime: null },
        ],
      })
    }),
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role }),
    ),
    http.get(`${API_BASE}/orders`, () => {
      fetchedOrders()
      return HttpResponse.json([
        makeOrder({ id: 1 }),
        makeOrder({ id: 2, is_scheduled: true }),
        makeOrder({ id: 3, status: "pending_approval" }),
        makeOrder({ id: 4, status: "pending_approval" }),
        makeOrder({ id: 5, status: "pending_approval" }),
        makeOrder({ id: 6, status: "confirmed" }),
        makeOrder({ id: 7, status: "in_progress" }),
      ])
    }),
  )
  render(
    <SidebarProvider>
      <AppSidebar user={{ id: "u-1", email: "member@example.com" }} />
    </SidebarProvider>,
  )
  return { fetchedOrders, fetchedProgress }
}

describe("AppSidebar（Issue #555 / #556）", () => {
  it("「受注管理」はすべての注文を開き、サブメニューに起票の確認・承認・受信メール処理結果がある", async () => {
    setup("iso_officer")

    expect(await screen.findByRole("link", { name: "受注管理" })).toHaveAttribute("href", "/orders")
    expect(screen.getByRole("link", { name: /起票の確認/ })).toHaveAttribute("href", "/orders/intake")
    expect(screen.getByRole("link", { name: "承認" })).toHaveAttribute("href", "/orders/approval")
    expect(screen.getByRole("link", { name: "送品の消し込み" })).toHaveAttribute("href", "/orders/shipping")
    expect(screen.getByRole("link", { name: "受信メール処理結果" })).toHaveAttribute(
      "href",
      "/orders/email-intake",
    )
  })

  it.each<MemberRole>(["order_handler", "iso_officer"])(
    "%s には起票の確認に下書きの件数バッジを出す",
    async (role) => {
      setup(role)

      expect(await screen.findByLabelText("2件")).toBeInTheDocument()
      expect(screen.getByRole("link", { name: /起票の確認/ })).toHaveTextContent("起票の確認2")
      // 承認待ちの件数は社長にだけ出す
      expect(screen.getByRole("link", { name: "承認" })).toHaveTextContent(/^承認$/)
      expect(screen.queryByLabelText("3件")).toBeNull()
    },
  )

  it("president には承認に承認待ちの件数バッジを出し、起票の確認には出さない", async () => {
    setup("president")

    expect(await screen.findByLabelText("3件")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /^承認\s*3件$/ })).toHaveTextContent("承認3")
    expect(screen.getByRole("link", { name: "起票の確認" })).toHaveTextContent(/^起票の確認$/)
    expect(screen.queryByLabelText("2件")).toBeNull()
  })

  it.each<MemberRole>(["president", "order_handler"])(
    "%s には送品の消し込みに候補の件数バッジを出す",
    async (role) => {
      setup(role)

      expect(await screen.findByLabelText("1件")).toBeInTheDocument()
      expect(screen.getByRole("link", { name: /送品の消し込み/ })).toHaveTextContent("送品の消し込み1")
    },
  )

  it("iso_officer には送品の消し込みの件数バッジを出さず、日報の進捗も取得しない", async () => {
    const { fetchedProgress } = setup("iso_officer")

    expect(await screen.findByLabelText("2件")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "送品の消し込み" })).toHaveTextContent(/^送品の消し込み$/)
    expect(fetchedProgress).not.toHaveBeenCalled()
  })

  it("platform_admin には件数バッジを出さず、注文も取得しない", async () => {
    const { fetchedOrders, fetchedProgress } = setup("platform_admin")

    await screen.findByRole("link", { name: "起票の確認" })
    // ロールの取得を待ってから、バッジ用の注文取得が走っていないことを確かめる
    await waitFor(() => expect(screen.getByRole("link", { name: "承認監査ログ" })).toBeInTheDocument())
    expect(screen.queryByLabelText("2件")).toBeNull()
    expect(screen.queryByLabelText("3件")).toBeNull()
    expect(fetchedOrders).not.toHaveBeenCalled()
    expect(fetchedProgress).not.toHaveBeenCalled()
  })
})
