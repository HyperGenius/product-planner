import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { OrderProgress, ProcessProgress } from "@/types/daily-report-progress"
import { OrderProcessProgress } from "./order-process-progress"

const ORDER_ID = 1000001

function progress(overrides: Partial<ProcessProgress> & Pick<ProcessProgress, "process_routing_id">): ProcessProgress {
  return {
    order_id: ORDER_ID,
    sequence_order: 1,
    process_name: null,
    good_qty: 0,
    order_quantity: 100,
    first_actual_date: null,
    last_actual_date: null,
    status: "not_started",
    completed_by: null,
    planned_end_datetime: null,
    ...overrides,
  }
}

function respond(body: OrderProgress) {
  server.use(http.get(`${API_BASE}/orders/${ORDER_ID}/progress`, () => HttpResponse.json(body)))
}

function row(processName: string): HTMLElement {
  return screen.getByText(processName).closest("tr")!
}

describe("OrderProcessProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-12T03:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("工程ごとの実績数量・状態・実績日を出し、遅れている工程に印を付ける", async () => {
    respond({
      order_id: ORDER_ID,
      computed_at: "2026-09-12T02:00:00Z",
      processes: [
        progress({
          process_routing_id: 11,
          sequence_order: 1,
          process_name: "プレス",
          good_qty: 100,
          status: "completed",
          completed_by: "quantity",
          first_actual_date: "2026-09-10",
          last_actual_date: "2026-09-10",
        }),
        progress({
          process_routing_id: 12,
          sequence_order: 2,
          process_name: "洗浄",
          status: "completed",
          completed_by: "later_process",
        }),
        progress({
          process_routing_id: 13,
          sequence_order: 3,
          process_name: "カシメ",
          good_qty: 25,
          status: "in_progress",
          first_actual_date: "2026-09-11",
          last_actual_date: "2026-09-11",
          planned_end_datetime: "2026-09-11T08:00:00Z",
        }),
        progress({
          process_routing_id: 14,
          sequence_order: 4,
          process_name: "クグシ",
          planned_end_datetime: "2026-09-20T08:00:00Z",
        }),
      ],
    })

    render(<OrderProcessProgress orderId={ORDER_ID} />)

    expect(await screen.findByText("プレス")).toBeInTheDocument()
    expect(within(row("プレス")).getByText("100 / 100")).toBeInTheDocument()
    expect(within(row("プレス")).getByText("完了")).toBeInTheDocument()
    expect(within(row("プレス")).getByText("9/10")).toBeInTheDocument()

    expect(within(row("洗浄")).getByText("完了（後工程の実績から推定）")).toBeInTheDocument()

    expect(within(row("カシメ")).getByText("25 / 100")).toBeInTheDocument()
    expect(within(row("カシメ")).getByText("進行中")).toBeInTheDocument()
    expect(within(row("カシメ")).getByText("遅れ")).toBeInTheDocument()

    expect(within(row("クグシ")).getByText("未着手")).toBeInTheDocument()
    expect(within(row("クグシ")).queryByText("遅れ")).not.toBeInTheDocument()

    expect(screen.getByText(/時点の日報から集計/)).toBeInTheDocument()
  })

  it("一度も集計していなければその旨を出す", async () => {
    respond({ order_id: ORDER_ID, computed_at: null, processes: [] })
    render(<OrderProcessProgress orderId={ORDER_ID} />)
    expect(await screen.findByText("日報の進捗はまだ集計されていません")).toBeInTheDocument()
  })

  it("取得に失敗したらエラーを出す", async () => {
    server.use(
      http.get(`${API_BASE}/orders/${ORDER_ID}/progress`, () =>
        HttpResponse.json({ detail: "error" }, { status: 500 }),
      ),
    )
    render(<OrderProcessProgress orderId={ORDER_ID} />)
    expect(await screen.findByText("工程の進捗を取得できませんでした")).toBeInTheDocument()
  })
})
