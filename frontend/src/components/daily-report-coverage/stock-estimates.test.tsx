import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type {
  StockEstimates as StockEstimatesData,
  StockFeedback,
} from "@/types/daily-report-stock"
import { StockEstimates } from "./stock-estimates"

/** 日報からの作り置きの推定の区画 (Issue #591)。製品はダミー値（実データを含めない） */

const FEEDBACK: StockFeedback = {
  product_id: 2,
  product_name: "テスト製品B",
  product_code: null,
  kind: "not_stocked",
  process_name: null,
  baseline_qty: null,
  baseline_date: null,
  note: "試作の残り",
  updated_by: "u1",
  updated_at: "2026-10-28T01:00:00Z",
}

const DATA: StockEstimatesData = {
  computed_at: "2026-10-29T03:00:00Z",
  items: [
    {
      product_id: 1,
      product_name: "テスト製品A",
      product_code: "P-001",
      process_name: "プレス",
      next_process_name: "カシメ",
      qty: 1200,
      last_movement_date: "2026-10-20",
    },
  ],
  feedback: [FEEDBACK],
}

function mockStock(data: StockEstimatesData = DATA) {
  const writes: { method: string; url: string; body: unknown }[] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/stock-estimates`, () => HttpResponse.json(data)),
    http.get(`${API_BASE}/process-routings`, () =>
      HttpResponse.json(
        ["カシメ", "プレス"].map((name, i) => ({
          id: i + 1,
          product_id: 1,
          process_name: name,
          sequence_order: name === "プレス" ? 1 : 2,
        })),
      ),
    ),
    http.put(`${API_BASE}/daily-reports/stock-feedback/:productId`, async ({ request }) => {
      writes.push({ method: "PUT", url: request.url, body: await request.json() })
      return HttpResponse.json({ ...FEEDBACK, product_id: 1 })
    }),
    http.delete(`${API_BASE}/daily-reports/stock-feedback/:productId`, ({ request }) => {
      writes.push({ method: "DELETE", url: request.url, body: null })
      return HttpResponse.json({ status: "deleted" })
    }),
  )
  return writes
}

const section = () => screen.getByRole("region", { name: /作り置き（推定）/ })

describe("StockEstimates", () => {
  it("推定数と、推定を出していない製品の指摘を出す", async () => {
    mockStock()
    render(<StockEstimates canEdit />)

    expect(await screen.findByText("1,200 個")).toBeInTheDocument()
    expect(within(section()).getByText("「プレス」の後")).toBeInTheDocument()
    expect(within(section()).getByText(/「カシメ」で使うと減ります・最後の動き 2026\/10\/20/)).toBeInTheDocument()
    expect(within(section()).getByText("テスト製品B")).toBeInTheDocument()
    expect(within(section()).getByText("作り置きしていない")).toBeInTheDocument()
    expect(within(section()).getByText("（試作の残り）")).toBeInTheDocument()
  })

  it("推定も指摘も無ければ出さない", async () => {
    let requested = false
    server.use(
      http.get(`${API_BASE}/daily-reports/stock-estimates`, () => {
        requested = true
        return HttpResponse.json({ ...DATA, items: [], feedback: [] })
      }),
    )
    render(<StockEstimates canEdit />)

    await waitFor(() => expect(requested).toBe(true))
    expect(screen.queryByRole("region", { name: /作り置き/ })).not.toBeInTheDocument()
  })

  it("編集できないロールでは「違う」を押せない", async () => {
    mockStock()
    render(<StockEstimates canEdit={false} />)

    await screen.findByText("1,200 個")
    expect(screen.getByRole("button", { name: "テスト製品A（P-001）の違う" })).toBeDisabled()
  })

  it("工程と実際の数を指摘する", async () => {
    const writes = mockStock()
    render(<StockEstimates canEdit />)

    await userEvent.click(
      await screen.findByRole("button", { name: "テスト製品A（P-001）の違う" }),
    )
    const dialog = await screen.findByRole("dialog", { name: "作り置きの推定が違う" })
    // 工程ルートの順に並び、推定の工程が選ばれている
    const processes = within(within(dialog).getByRole("group", { name: "作り置きの工程" }))
    await waitFor(() =>
      expect(processes.getAllByRole("button").map((b) => b.textContent)).toEqual(["プレス", "カシメ"]),
    )
    expect(processes.getByRole("button", { name: "プレス", pressed: true })).toBeInTheDocument()

    await userEvent.click(processes.getByRole("button", { name: "カシメ" }))
    await userEvent.type(within(dialog).getByLabelText("実際の数（任意）"), "12")
    await userEvent.click(within(dialog).getByRole("button", { name: "登録する" }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].url).toMatch(/\/daily-reports\/stock-feedback\/1$/)
    expect(writes[0].body).toMatchObject({
      kind: "stock_process",
      process_name: "カシメ",
      baseline_qty: 12,
      note: null,
    })
    expect((writes[0].body as { baseline_date: string }).baseline_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("入力の誤りは送らずに出す", async () => {
    const writes = mockStock()
    render(<StockEstimates canEdit />)

    await userEvent.click(
      await screen.findByRole("button", { name: "テスト製品A（P-001）の違う" }),
    )
    const dialog = await screen.findByRole("dialog")
    await userEvent.type(within(dialog).getByLabelText("実際の数（任意）"), "abc")
    await userEvent.click(within(dialog).getByRole("button", { name: "登録する" }))

    expect(within(dialog).getByRole("alert")).toHaveTextContent("数は0以上の整数で入力してください")
    expect(writes).toEqual([])
  })

  it("指摘済みの製品は指摘を直す・取り消すことができる", async () => {
    const writes = mockStock()
    render(<StockEstimates canEdit />)

    await userEvent.click(await screen.findByRole("button", { name: "テスト製品Bの指摘を直す" }))
    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByRole("button", { name: "作り置きしていない", pressed: true }),
    ).toBeInTheDocument()
    expect(within(dialog).getByLabelText("メモ（任意）")).toHaveValue("試作の残り")

    await userEvent.click(within(dialog).getByRole("button", { name: "指摘を取り消す" }))

    await waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].method).toBe("DELETE")
    expect(writes[0].url).toMatch(/\/daily-reports\/stock-feedback\/2$/)
  })
})
