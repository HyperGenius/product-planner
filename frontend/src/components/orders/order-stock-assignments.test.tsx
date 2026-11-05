import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { MemberRole } from "@/types/member"
import type { OrderStockAssignments as Data, StockAssignment, StockSourceEntry } from "@/types/daily-report-stock"
import { OrderStockAssignments } from "./order-stock-assignments"

/** 受注詳細の「作り置きからの引き当て」(Issue #624)。工程・数はダミー値 */

const URL = `${API_BASE}/daily-reports/orders/1/stock-assignments`

const ASSIGNMENT: StockAssignment = {
  id: "a-1",
  order_id: 1,
  process_name: "カシメ",
  qty: 30,
  assigned_on: "2026-11-02",
  note: "棚の分",
  updated_by: "u-1",
  updated_at: "2026-11-02T01:00:00Z",
  sources: [],
}

const SOURCE: StockSourceEntry = {
  entry_id: 11,
  work_date: "2026-10-20",
  product_raw: "ボルトM6 作り置き",
  customer_raw: "A社",
  equipment_raw: "50t 3号機",
  qty: 30,
}

const DATA: Data = {
  computed_at: "2026-11-02T03:00:00Z",
  assignable: true,
  product_name: "ボルトM6",
  product_code: "B-06",
  process_names: ["プレス", "カシメ", "クグシ"],
  stock_estimates: [
    { process_name: "カシメ", next_process_name: "クグシ", qty: 28, last_movement_date: "2026-10-13" },
    { process_name: "クグシ", next_process_name: null, qty: 8222, last_movement_date: "2026-10-14" },
  ],
  assignments: [],
  candidates: {},
}

function setup({ data = DATA, role = "order_handler" }: { data?: Data; role?: MemberRole } = {}) {
  const puts: unknown[] = []
  const deletes: string[] = []
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role }),
    ),
    http.get(URL, () => HttpResponse.json(data)),
    http.put(URL, async ({ request }) => {
      puts.push(await request.json())
      return HttpResponse.json(ASSIGNMENT)
    }),
    http.delete(`${URL}/:id`, ({ params }) => {
      deletes.push(String(params.id))
      return HttpResponse.json({ status: "deleted" })
    }),
  )
  return { puts, deletes }
}

describe("OrderStockAssignments", () => {
  it("作り置きの推定と登録済みの引き当てを表示する", async () => {
    setup({ data: { ...DATA, assignments: [ASSIGNMENT] } })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    expect(
      await screen.findByText("「カシメ」の後 28 個 / 「クグシ」の後 8,222 個"),
    ).toBeInTheDocument()
    expect(screen.getByText("棚の分")).toBeInTheDocument()
    expect(screen.getByText("2026/11/02")).toBeInTheDocument()
  })

  it("引き当て先の製品と、充当した日報の明細（日報の表記）を表示する", async () => {
    setup({
      data: {
        ...DATA,
        assignments: [
          { ...ASSIGNMENT, sources: [SOURCE] },
          { ...ASSIGNMENT, id: "a-2", process_name: "クグシ" },
        ],
      },
    })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    expect(await screen.findByText("ボルトM6（B-06）")).toBeInTheDocument()
    expect(screen.getByText("ボルトM6 作り置き")).toBeInTheDocument()
    expect(screen.getByText("A社 / 50t 3号機")).toBeInTheDocument()
    // 集計前の引き当ては、元の明細がまだ無いことを示す
    expect(screen.getByText("次の集計で表示されます")).toBeInTheDocument()
  })

  it("ダイアログで選んだ工程の引き当て元の候補を表示する", async () => {
    setup({ data: { ...DATA, candidates: { クグシ: [SOURCE] } } })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await userEvent.click(await screen.findByRole("button", { name: "作り置きから引き当てる" }))
    expect(screen.getByText("ボルトM6 作り置き")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "カシメ" }))
    expect(screen.getByText("この工程で未割当の日報の明細はありません")).toBeInTheDocument()
  })

  it("候補の件数を出し、件数が違っても候補の枠は同じ固定高のままにする（Issue #633）", async () => {
    setup({ data: { ...DATA, candidates: { クグシ: [SOURCE] } } })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await userEvent.click(await screen.findByRole("button", { name: "作り置きから引き当てる" }))
    expect(screen.getByText(/引き当て元の候補（1 件）/)).toBeInTheDocument()
    const frame = screen.getByTestId("stock-candidates")
    expect(frame).toHaveClass("h-40", "overflow-y-auto")

    await userEvent.click(screen.getByRole("button", { name: "カシメ" }))
    expect(screen.getByText(/引き当て元の候補（0 件）/)).toBeInTheDocument()
    expect(screen.getByTestId("stock-candidates")).toHaveClass("h-40", "overflow-y-auto")
  })

  it("最も後の工程の推定を初期値にして引き当てを登録する", async () => {
    const { puts } = setup()
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await userEvent.click(await screen.findByRole("button", { name: "作り置きから引き当てる" }))
    expect(screen.getByRole("button", { name: "クグシ", pressed: true })).toBeInTheDocument()
    expect(screen.getByLabelText("数")).toHaveValue("5000")
    await userEvent.click(screen.getByRole("button", { name: "引き当てる" }))

    await waitFor(() =>
      expect(puts).toEqual([{ process_name: "クグシ", qty: 5000, note: null }]),
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("受注数量を超える数は登録しない", async () => {
    const { puts } = setup()
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await userEvent.click(await screen.findByRole("button", { name: "作り置きから引き当てる" }))
    await userEvent.clear(screen.getByLabelText("数"))
    await userEvent.type(screen.getByLabelText("数"), "5001")
    await userEvent.click(screen.getByRole("button", { name: "引き当てる" }))

    expect(screen.getByText("数は受注数量（5,000）以下にしてください")).toBeInTheDocument()
    expect(puts).toEqual([])
  })

  it("引き当てを取り消す", async () => {
    const { deletes } = setup({ data: { ...DATA, assignments: [ASSIGNMENT] } })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await userEvent.click(await screen.findByRole("button", { name: "取り消す" }))

    await waitFor(() => expect(deletes).toEqual(["a-1"]))
  })

  it("編集できないロールには登録・取り消しの操作を出さない", async () => {
    setup({ data: { ...DATA, assignments: [ASSIGNMENT] }, role: "iso_officer" })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    expect(await screen.findByText("棚の分")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "作り置きから引き当てる" })).toBeNull()
    expect(screen.queryByRole("button", { name: "取り消す" })).toBeNull()
  })

  it("引き当てられない受注で引き当てが無ければ何も出さない", async () => {
    setup({ data: { ...DATA, assignable: false } })
    const { container } = render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
