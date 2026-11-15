import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
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
  candidate_totals: {},
}

function setup({
  data = DATA,
  role = "order_handler",
  progress = [],
}: {
  data?: Data
  role?: MemberRole
  progress?: { process_name: string; good_qty: number }[]
} = {}) {
  const puts: unknown[] = []
  const deletes: string[] = []
  server.use(
    http.get(`${API_BASE}/orders/1/progress`, () =>
      HttpResponse.json({
        order_id: 1,
        computed_at: "2026-11-02T03:00:00Z",
        processes: progress.map((p, i) => ({
          order_id: 1,
          process_routing_id: i + 1,
          sequence_order: i + 1,
          order_quantity: 5000,
          first_actual_date: null,
          last_actual_date: null,
          status: "in_progress",
          completed_by: null,
          planned_end_datetime: null,
          ...p,
        })),
      }),
    ),
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

async function openDialog() {
  await userEvent.click(await screen.findByRole("button", { name: "作り置きから引き当てる" }))
  await screen.findByRole("dialog")
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
    setup({ data: { ...DATA, candidates: { クグシ: [SOURCE] }, candidate_totals: { クグシ: { count: 1, qty: 30 } } } })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await openDialog()
    expect(within(screen.getByTestId("stock-candidates")).getByText("ボルトM6 作り置き")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("radio", { name: "カシメ" }))
    expect(screen.getByText("この工程で未割当の日報の明細はありません")).toBeInTheDocument()
  })

  it("工程の表と明細の枠は、工程を切り替えても同じ固定高のままにする（Issue #633）", async () => {
    setup({ data: { ...DATA, candidates: { クグシ: [SOURCE] }, candidate_totals: { クグシ: { count: 1, qty: 30 } } } })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await openDialog()
    expect(screen.getByText(/引き当て元の明細（1 件/)).toBeInTheDocument()
    expect(screen.getByTestId("stock-process-table")).toHaveClass("h-48", "overflow-y-auto")
    expect(screen.getByTestId("stock-candidates")).toHaveClass("h-32", "overflow-y-auto")

    await userEvent.click(screen.getByRole("radio", { name: "カシメ" }))
    expect(screen.getByText(/引き当て元の明細（0 件/)).toBeInTheDocument()
    expect(screen.getByTestId("stock-candidates")).toHaveClass("h-32", "overflow-y-auto")
  })

  it("工程の表に推定・未割当の日報・この受注の実績・登録済みを工程ルートの順に出す（Issue #673）", async () => {
    setup({
      data: {
        ...DATA,
        assignments: [{ ...ASSIGNMENT, process_name: "プレス", qty: 10 }],
        candidate_totals: { クグシ: { count: 45, qty: 9000 } },
      },
      progress: [{ process_name: "プレス", good_qty: 10 }],
    })
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await openDialog()
    const table = screen.getByRole("table", { name: "引き当てる工程" })
    const rowTexts = () => within(table).getAllByRole("row").slice(1).map((r) => r.textContent)
    // 列: 済んだ工程 / 推定 / 未割当の日報 / この受注の実績 / 登録済み
    await waitFor(() =>
      expect(rowTexts()).toEqual([
        "プレス－－1010 個",
        "カシメ28 個－－",
        // 明細は30件で打ち切るが、合計は API の全件の値
        "クグシ8,222 個45 件 / 9,000 個－",
      ]),
    )
  })

  it("引き当て元と引き当て先の品名・顧客・工程・数を並べ、充てる明細の見込みを出す（Issue #673）", async () => {
    setup({
      data: {
        ...DATA,
        candidates: { クグシ: [SOURCE, { ...SOURCE, entry_id: 12, product_raw: "M6ボルト", qty: 50 }] },
        candidate_totals: { クグシ: { count: 2, qty: 80 } },
      },
    })
    render(
      <OrderStockAssignments orderId={1} orderQuantity={40} orderCustomerId={1} orderCustomerLabel="A社" />,
    )

    await openDialog()
    const comparison = screen.getByTestId("stock-comparison")
    expect(within(comparison).getByRole("row", { name: /品名/ })).toHaveTextContent(
      "品名ボルトM6 作り置き / M6ボルトボルトM6（B-06）",
    )
    expect(within(comparison).getByRole("row", { name: /顧客/ })).toHaveTextContent("顧客A社A社")
    expect(within(comparison).getByRole("row", { name: /工程/ })).toHaveTextContent(
      "工程「クグシ」まで済み残りの工程はありません",
    )
    expect(within(comparison).getByRole("row", { name: /数/ })).toHaveTextContent(
      "数未割当の日報 合計 80 個（2 件）受注数量 40 個",
    )
    // 数の初期値は min(推定, 受注数量)。新しい順に 30 → 10 を充てる
    expect(screen.getByLabelText("引き当てる数")).toHaveValue("40")
    const candidates = screen.getByTestId("stock-candidates")
    expect(within(candidates).getByText("→ 30 個を充てる")).toBeInTheDocument()
    expect(within(candidates).getByText("→ 10 個を充てる")).toBeInTheDocument()
  })

  it("工程を切り替えると数の初期値を選び直し、手で変えた後は上書きしない（Issue #673）", async () => {
    setup()
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await openDialog()
    expect(screen.getByLabelText("引き当てる数")).toHaveValue("5000")
    await userEvent.click(screen.getByRole("radio", { name: "カシメ" }))
    expect(screen.getByLabelText("引き当てる数")).toHaveValue("28")

    await userEvent.clear(screen.getByLabelText("引き当てる数"))
    await userEvent.type(screen.getByLabelText("引き当てる数"), "12")
    await userEvent.click(screen.getByRole("radio", { name: "クグシ" }))
    expect(screen.getByLabelText("引き当てる数")).toHaveValue("12")
  })

  it("未割当の合計を超える数・顧客先の違い・上書きを注意として出し、登録は妨げない（Issue #673）", async () => {
    const { puts } = setup({
      data: {
        ...DATA,
        assignments: [{ ...ASSIGNMENT, process_name: "クグシ", qty: 100 }],
        candidates: { クグシ: [{ ...SOURCE, customer_id: 2 }] },
        candidate_totals: { クグシ: { count: 1, qty: 30 } },
      },
    })
    render(
      <OrderStockAssignments orderId={1} orderQuantity={5000} orderCustomerId={1} orderCustomerLabel="A社" />,
    )

    await openDialog()
    const warnings = screen.getByRole("list", { name: "注意" })
    expect(warnings).toHaveTextContent("未割当の日報は合計 30 個です。集計で充てられるのは 30 個までです")
    expect(warnings).toHaveTextContent("日報の顧客先が受注の顧客と違う明細があります")
    expect(warnings).toHaveTextContent("登録済みの引き当て（100 個）を上書きします")

    await userEvent.click(screen.getByRole("button", { name: "引き当てる" }))
    await waitFor(() => expect(puts).toEqual([{ process_name: "クグシ", qty: 100, note: null }]))
  })

  it("最も後の工程の推定を初期値にして引き当てを登録する", async () => {
    const { puts } = setup()
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await openDialog()
    expect(screen.getByRole("radio", { name: "クグシ" })).toBeChecked()
    expect(screen.getByLabelText("引き当てる数")).toHaveValue("5000")
    await userEvent.click(screen.getByRole("button", { name: "引き当てる" }))

    await waitFor(() =>
      expect(puts).toEqual([{ process_name: "クグシ", qty: 5000, note: null }]),
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("受注数量を超える数は登録しない", async () => {
    const { puts } = setup()
    render(<OrderStockAssignments orderId={1} orderQuantity={5000} />)

    await openDialog()
    await userEvent.clear(screen.getByLabelText("引き当てる数"))
    await userEvent.type(screen.getByLabelText("引き当てる数"), "5001")
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
