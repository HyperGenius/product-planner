import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Order } from "@/types/order"
import { RepairOrderDetail } from "./repair-order-detail"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

/**
 * 修理・メンテナンス・洗浄など、製品を持たない注文の詳細（Issue #494）。
 */

function makeRepairOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 7,
    order_no: "R-1",
    order_type: "repair",
    work_description: "部品の補修\n・補修部1〜3ヶ所 ×11枚",
    product_id: null,
    quantity: null,
    customer_id: 1,
    desired_deadline: "2026-10-20",
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

function useRole(role: string) {
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u1", role, email: "u@example.com" }),
    ),
    http.get(`${API_BASE}/orders/7/attachments`, () => HttpResponse.json([])),
  )
}

describe("RepairOrderDetail", () => {
  it("件名・作業内容と日付を出し、製品・数量・シミュレーションは出さない", async () => {
    useRole("order_handler")
    render(<RepairOrderDetail order={makeRepairOrder()} />)

    expect(screen.getByText("修理等")).toBeInTheDocument()
    expect(screen.getByText(/補修部1〜3ヶ所 ×11枚/)).toBeInTheDocument()
    expect(screen.getByText("実施開始日")).toBeInTheDocument()
    expect(screen.getByText("完了予定日")).toBeInTheDocument()
    expect(screen.queryByText("製品")).not.toBeInTheDocument()
    expect(screen.queryByText("数量")).not.toBeInTheDocument()
    expect(screen.queryByText("シミュレーション結果")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /シミュレーション/ })).not.toBeInTheDocument()
  })

  it("実施開始日と完了予定日が揃うまで承認依頼を押せず、理由を表示する", async () => {
    useRole("order_handler")
    render(
      <RepairOrderDetail
        order={makeRepairOrder({ scheduling_start_date: "2026-10-10" })}
      />,
    )

    expect(await screen.findByRole("button", { name: "承認依頼を送信" })).toBeDisabled()
    expect(screen.getByText(/完了予定日を入力すると承認依頼できます/)).toBeInTheDocument()
  })

  it("両方の日付が入っていれば承認依頼を押せる", async () => {
    useRole("order_handler")
    render(
      <RepairOrderDetail
        order={makeRepairOrder({
          scheduling_start_date: "2026-10-10",
          simulated_deadline: "2026-10-15",
          is_scheduled: true,
        })}
      />,
    )

    expect(await screen.findByRole("button", { name: "承認依頼を送信" })).toBeEnabled()
    expect(screen.queryByText(/承認依頼できます/)).not.toBeInTheDocument()
  })

  it("承認待ちは社長に承認・差し戻しを出す", async () => {
    useRole("president")
    render(
      <RepairOrderDetail
        order={makeRepairOrder({
          status: "pending_approval",
          scheduling_start_date: "2026-10-10",
          simulated_deadline: "2026-10-15",
        })}
      />,
    )

    expect(await screen.findByRole("button", { name: "承認" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "差し戻し" })).toBeInTheDocument()
  })

  it("承認後は確定した完了予定日を表示する", async () => {
    useRole("president")
    render(
      <RepairOrderDetail
        order={makeRepairOrder({
          status: "confirmed",
          scheduling_start_date: "2026-10-10",
          simulated_deadline: "2026-10-15",
          confirmed_deadline: "2026-10-15",
        })}
      />,
    )

    expect(screen.getByText("確定した完了予定日")).toBeInTheDocument()
    expect(screen.getByText("2026/10/15")).toBeInTheDocument()
  })
})
