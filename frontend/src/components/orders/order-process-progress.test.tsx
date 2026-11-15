import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { fireEvent, render, screen, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { OrderProgress, ProcessProgress } from "@/types/daily-report-progress"
import type { OrderStockAssignments } from "@/types/daily-report-stock"
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

  describe("作り置きの引き当ての案内（Issue #673）", () => {
    const STOCK: OrderStockAssignments = {
      computed_at: "2026-09-12T02:00:00Z",
      assignable: true,
      product_name: "テスト製品",
      product_code: null,
      process_names: ["プレス", "検査"],
      stock_estimates: [
        { process_name: "プレス", next_process_name: "検査", qty: 40, last_movement_date: null },
      ],
      assignments: [],
      candidates: {},
      candidate_totals: {},
    }
    const NOT_STARTED: OrderProgress = {
      order_id: ORDER_ID,
      computed_at: "2026-09-12T02:00:00Z",
      processes: [
        progress({ process_routing_id: 11, sequence_order: 1, process_name: "プレス" }),
        progress({ process_routing_id: 12, sequence_order: 2, process_name: "検査" }),
      ],
    }
    const HINT = /日報の実績が付いていない工程があります/

    function respondStock(body: OrderStockAssignments) {
      const state = { fetched: false }
      server.use(
        http.get(`${API_BASE}/daily-reports/orders/${ORDER_ID}/stock-assignments`, () => {
          state.fetched = true
          return HttpResponse.json(body)
        }),
      )
      return state
    }

    it("実績の付いていない工程があり引き当てられるものがあれば、引き当てのカードへ案内する", async () => {
      respond(NOT_STARTED)
      respondStock(STOCK)
      const target = document.createElement("div")
      target.id = "stock-target"
      target.scrollIntoView = vi.fn()
      document.body.appendChild(target)
      try {
        render(<OrderProcessProgress orderId={ORDER_ID} stockHintTargetId="stock-target" />)

        expect(await screen.findByText(HINT)).toBeInTheDocument()
        fireEvent.click(screen.getByRole("button", { name: "作り置きからの引き当てへ" }))
        expect(target.scrollIntoView).toHaveBeenCalled()
      } finally {
        target.remove()
      }
    })

    it.each<[string, OrderProgress, OrderStockAssignments]>([
      [
        "すべての工程に実績がある",
        {
          ...NOT_STARTED,
          processes: NOT_STARTED.processes.map((p) => ({ ...p, status: "completed" as const })),
        },
        STOCK,
      ],
      ["引き当てられるものが無い", NOT_STARTED, { ...STOCK, stock_estimates: [] }],
      [
        "反映待ちの引き当てがある",
        NOT_STARTED,
        {
          ...STOCK,
          assignments: [
            {
              id: "a-1",
              order_id: ORDER_ID,
              process_name: "プレス",
              qty: 40,
              assigned_on: "2026-09-12",
              note: null,
              updated_by: "u",
              updated_at: "2026-09-12T02:30:00Z",
              sources: [],
            },
          ],
        },
      ],
    ])("%s ときは案内しない", async (_label, progressBody, stock) => {
      respond(progressBody)
      const state = respondStock(stock)
      render(<OrderProcessProgress orderId={ORDER_ID} stockHintTargetId="stock-target" />)

      expect(await screen.findByText("プレス")).toBeInTheDocument()
      // 引き当ての取得を待ってから、案内が無いことを確かめる
      await waitFor(() => expect(state.fetched).toBe(true))
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.queryByText(HINT)).toBeNull()
    })

    it("案内の先を渡さなければ引き当てを取得しない（他の画面で使うとき）", async () => {
      respond(NOT_STARTED)
      let fetched = false
      server.use(
        http.get(`${API_BASE}/daily-reports/orders/${ORDER_ID}/stock-assignments`, () => {
          fetched = true
          return HttpResponse.json(STOCK)
        }),
      )
      render(<OrderProcessProgress orderId={ORDER_ID} />)

      expect(await screen.findByText("プレス")).toBeInTheDocument()
      expect(fetched).toBe(false)
      expect(screen.queryByText(HINT)).toBeNull()
    })
  })
  it("日報で追わない工程は「日報の対象外」として工程順に並べる（Issue #681）", async () => {
    respond({
      order_id: ORDER_ID,
      computed_at: "2026-09-12T02:00:00Z",
      processes: [
        progress({ process_routing_id: 11, sequence_order: 1, process_name: "プレス", status: "completed", completed_by: "quantity", good_qty: 100 }),
        progress({ process_routing_id: 13, sequence_order: 3, process_name: "クグシ" }),
      ],
    })
    const routing = (id: number, sequence_order: number, process_name: string) => ({
      id,
      product_id: 7,
      process_name,
      equipment_group_id: null,
      sequence_order,
      setup_time_seconds: 0,
      unit_time_seconds: 1,
      is_confirmed: true,
      confirmed_by: null,
      confirmed_at: null,
      tenant_id: "tenant-1",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    })
    server.use(
      http.get(`${API_BASE}/process-routings`, () =>
        HttpResponse.json([routing(11, 1, "プレス"), routing(12, 2, "外観検査"), routing(13, 3, "クグシ"), routing(14, 4, "検査")]),
      ),
      http.get(`${API_BASE}/untracked-process-names`, () =>
        HttpResponse.json([
          { id: 1, process_name: "検査", created_at: "2026-11-15T00:00:00Z" },
          { id: 2, process_name: "外観検査", created_at: "2026-11-15T00:00:00Z" },
        ]),
      ),
    )

    render(<OrderProcessProgress orderId={ORDER_ID} productId={7} />)

    await screen.findByText("検査")
    const names = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent)
    expect(names).toEqual(["プレス", "外観検査", "クグシ", "検査"])
    expect(within(row("検査")).getByText("日報の対象外")).toBeInTheDocument()
    expect(within(row("外観検査")).getByText("日報の対象外")).toBeInTheDocument()
    expect(within(row("クグシ")).queryByText("日報の対象外")).toBeNull()
  })

  it("製品を渡さなければ工程ルートを取得しない", async () => {
    respond({
      order_id: ORDER_ID,
      computed_at: "2026-09-12T02:00:00Z",
      processes: [progress({ process_routing_id: 11, process_name: "プレス" })],
    })
    let routingRequested = false
    server.use(
      http.get(`${API_BASE}/process-routings`, () => {
        routingRequested = true
        return HttpResponse.json([])
      }),
    )

    render(<OrderProcessProgress orderId={ORDER_ID} />)

    await screen.findByText("プレス")
    expect(routingRequested).toBe(false)
  })
})
