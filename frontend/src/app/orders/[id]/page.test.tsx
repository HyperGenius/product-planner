import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Order, OrderSimulateResponse } from "@/types/order"
import OrderDetailPage from "./page"

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders/1",
}))

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
    has_no_routings: false,
    has_unconfirmed_routings: false,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

const STORED_SIMULATION: OrderSimulateResponse = {
  calculated_deadline: "2099-09-20T17:00:00+09:00",
  is_feasible: true,
  process_schedules: [
    {
      process_name: "保存済みの切削",
      start_time: "2099-09-18T09:00:00+09:00",
      end_time: "2099-09-20T17:00:00+09:00",
      equipment_name: "1号機",
    },
  ],
}

function mockOrder(order: Order): void {
  server.use(
    http.get(`${API_BASE}/orders/1`, () => HttpResponse.json(order)),
    http.get(`${API_BASE}/orders/1/attachments`, () => HttpResponse.json([])),
  )
}

function mockStoredSimulation(result: OrderSimulateResponse | null): void {
  server.use(http.get(`${API_BASE}/orders/1/simulation`, () => HttpResponse.json(result)))
}

describe("OrderDetailPage のシミュレーション結果", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API_BASE}/tenant/members/me`, () =>
        HttpResponse.json({
          user_id: "u-1",
          email: "member@example.com",
          full_name: "テスト",
          role: "order_handler",
        }),
      ),
    )
  })

  it("シミュ済みの下書きは保存済みの工程を表示し、ボタンを「シミュレーション再実行」にする", async () => {
    mockOrder(makeOrder({ is_scheduled: true, simulated_deadline: "2099-09-20" }))
    mockStoredSimulation(STORED_SIMULATION)
    render(<OrderDetailPage />)

    expect(await screen.findByText("保存済みの切削")).toBeInTheDocument()
    expect(screen.getByText("設備: 1号機")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "シミュレーション再実行" })).toBeInTheDocument()
  })

  it("未シミュの下書きは工程を出さず、ボタンは「シミュレーション実行」のまま", async () => {
    mockOrder(makeOrder({ is_scheduled: false }))
    mockStoredSimulation(null)
    render(<OrderDetailPage />)

    expect(await screen.findByRole("button", { name: "シミュレーション実行" })).toBeInTheDocument()
    expect(screen.queryByText("工程スケジュール")).toBeNull()
  })

  it("承認済みの受注には承認前のシミュ結果を出さない", async () => {
    mockOrder(
      makeOrder({
        status: "confirmed",
        is_scheduled: true,
        simulated_deadline: "2099-09-20",
        confirmed_deadline: "2099-09-21",
      }),
    )
    server.use(
      http.get(`${API_BASE}/orders/1/simulation`, () => HttpResponse.json(STORED_SIMULATION)),
      http.get(`${API_BASE}/orders/1/progress`, () =>
        HttpResponse.json({ order_id: 1, computed_at: null, processes: [] }),
      ),
    )
    render(<OrderDetailPage />)

    expect(await screen.findByText("確定納期")).toBeInTheDocument()
    expect(screen.queryByText("保存済みの切削")).toBeNull()
  })

  it("シミュレーションを実行すると結果の工程を表示し、ボタンを「シミュレーション再実行」にする", async () => {
    const executed: OrderSimulateResponse = {
      ...STORED_SIMULATION,
      process_schedules: [{ ...STORED_SIMULATION.process_schedules[0], process_name: "実行した切削" }],
    }
    // サーバー側の状態（実行で受注がシミュ済みになり、結果が保存される）
    let stored: OrderSimulateResponse | null = null
    server.use(
      http.get(`${API_BASE}/orders/1`, () =>
        HttpResponse.json(
          makeOrder(stored ? { is_scheduled: true, simulated_deadline: "2099-09-20" } : {}),
        ),
      ),
      http.get(`${API_BASE}/orders/1/attachments`, () => HttpResponse.json([])),
      http.get(`${API_BASE}/orders/1/simulation`, () => HttpResponse.json(stored)),
      http.post(`${API_BASE}/orders/1/simulate`, () => {
        stored = executed
        return HttpResponse.json(executed)
      }),
    )
    const user = userEvent.setup()
    render(<OrderDetailPage />)

    await user.click(await screen.findByRole("button", { name: "シミュレーション実行" }))

    expect(await screen.findByText("実行した切削")).toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "シミュレーション再実行" }),
    ).toBeInTheDocument()
  })
})
