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
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role }),
    ),
    http.get(`${API_BASE}/orders`, () => {
      fetchedOrders()
      return HttpResponse.json([
        makeOrder({ id: 1 }),
        makeOrder({ id: 2, is_scheduled: true }),
        makeOrder({ id: 3, status: "pending_approval" }),
      ])
    }),
  )
  render(
    <SidebarProvider>
      <AppSidebar user={{ id: "u-1", email: "member@example.com" }} />
    </SidebarProvider>,
  )
  return { fetchedOrders }
}

describe("AppSidebar（Issue #555）", () => {
  it("「受注管理」はすべての注文を開き、サブメニューに起票の確認・受信メール処理結果がある", async () => {
    setup("president")

    expect(await screen.findByRole("link", { name: "受注管理" })).toHaveAttribute("href", "/orders")
    expect(screen.getByRole("link", { name: "起票の確認" })).toHaveAttribute("href", "/orders/intake")
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
    },
  )

  it.each<MemberRole>(["president", "platform_admin"])(
    "%s には件数バッジを出さず、注文も取得しない",
    async (role) => {
      const { fetchedOrders } = setup(role)

      await screen.findByRole("link", { name: "起票の確認" })
      // ロールの取得を待ってから、バッジ用の注文取得が走っていないことを確かめる
      await waitFor(() => expect(screen.getByRole("link", { name: "承認監査ログ" })).toBeInTheDocument())
      expect(screen.queryByLabelText("2件")).toBeNull()
      expect(fetchedOrders).not.toHaveBeenCalled()
    },
  )
})
