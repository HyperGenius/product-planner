import { beforeEach, describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type {
  DailyReportCoverage as Coverage,
  UnallocatedActual,
  UnallocatedGroup,
} from "@/types/daily-report-progress"
import { DailyReportCoverage } from "./daily-report-coverage"

/**
 * 日報の照合状況の画面 (Issue #542)。製品・顧客はダミー値（実データを含めない）。
 * 製品 1（テスト製品A）は MSW の既定の製品マスタにある。
 */

function group(overrides: Partial<UnallocatedGroup>): UnallocatedGroup {
  return {
    product_id: 1,
    product_name: "テスト製品A",
    product_code: "P-001",
    product_has_routings: true,
    process_name: "プレス",
    reason: "no_candidate_order",
    category: "no_order",
    row_count: 2,
    qty: 10,
    first_work_date: "2026-09-01",
    last_work_date: "2026-09-10",
    customer_names: ["顧客A社"],
    ...overrides,
  }
}

const COVERAGE: Coverage = {
  computed_at: "2026-10-21T03:00:00Z",
  since: "2026-08-01",
  summary: {
    total_qty: 1000,
    allocated_qty: 600,
    unallocated_qty: 300,
    unmatched_rows: 4,
    unmatched_qty: 100,
    unallocated: [
      { category: "no_routing_process", row_count: 5, qty: 200 },
      { category: "closed_order_only", row_count: 3, qty: 80 },
      { category: "no_order", row_count: 2, qty: 20 },
    ],
  },
  groups: [
    group({
      product_id: 1,
      product_has_routings: false,
      process_name: "溶接",
      reason: "no_routing_process",
      category: "no_routing_process",
      row_count: 5,
      qty: 200,
    }),
    group({
      product_id: 2,
      product_name: "テスト製品B",
      product_code: null,
      category: "closed_order_only",
      row_count: 3,
      qty: 80,
    }),
    group({ product_id: 3, product_name: "テスト製品C", qty: 20 }),
  ],
}

function mockCoverage(coverage: Coverage = COVERAGE) {
  const requests: URL[] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/coverage`, ({ request }) => {
      requests.push(new URL(request.url))
      return HttpResponse.json(coverage)
    }),
  )
  return requests
}

const groupRows = () =>
  within(screen.getByRole("region", { name: "割り付けできなかった実績" }))
    .getAllByRole("button", { expanded: false })
    .map((b) => b.textContent)

describe("DailyReportCoverage", () => {
  beforeEach(() => {
    // 作り置きの推定（#591）は stock-estimates.test.tsx で見るので、ここでは空にする
    server.use(
      http.get(`${API_BASE}/daily-reports/stock-estimates`, () =>
        HttpResponse.json({ computed_at: null, items: [], feedback: [] }),
      ),
      http.get(`${API_BASE}/tenant/members/me`, () =>
        HttpResponse.json({ user_id: "u1", tenant_id: "tenant-1", role: "order_handler" }),
      ),
    )
  })

  it("割り付け済み・未割当・未照合の内訳と、未照合の名寄せへの導線を出す", async () => {
    const requests = mockCoverage()

    render(<DailyReportCoverage />)

    expect(await screen.findByText("600 / 1,000 個")).toBeInTheDocument()
    expect(screen.getByText("600 / 1,000 個")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /4 行を名寄せで対応付ける/ })).toHaveAttribute(
      "href",
      "/master/daily-report-names",
    )
    expect(screen.getByText(/2026\/08\/01 以降/)).toBeInTheDocument()
    // 既定は直近3か月
    expect(requests[0].searchParams.get("months")).toBe("3")
  })

  it("既定の「要確認」では出荷済みの受注のみの実績を除き、「すべて」で出す", async () => {
    mockCoverage()
    render(<DailyReportCoverage />)

    await screen.findByText("600 / 1,000 個")
    expect(groupRows()).toEqual([
      expect.stringContaining("テスト製品A（P-001）"),
      expect.stringContaining("テスト製品C"),
    ])
    expect(screen.getByText("この製品の工程に「溶接」がありません。実際の工程順は？")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /^すべて\s*3$/ }))

    expect(groupRows()).toHaveLength(3)
    expect(groupRows()[1]).toContain("テスト製品B")
  })

  it("サマリの内訳を押すと一覧をその分類に絞り込む", async () => {
    mockCoverage()
    render(<DailyReportCoverage />)

    await screen.findByText("600 / 1,000 個")
    await userEvent.click(screen.getByRole("button", { name: /^出荷済みの受注のみ\s*80/ }))

    expect(groupRows()).toEqual([expect.stringContaining("テスト製品B")])
    expect(
      screen.getByRole("button", { name: /^出荷済みの受注のみ\s*1$/, pressed: true }),
    ).toBeInTheDocument()
  })

  it("行を開くと、製品・工程名・理由・期間で絞り込んだ元の日報の行を出す", async () => {
    mockCoverage()
    const actual: UnallocatedActual = {
      id: 1,
      entry_id: 10,
      product_id: 3,
      customer_id: null,
      process_name: "プレス",
      work_date: "2026-09-10",
      qty: 12,
      reason: "no_candidate_order",
      sheet_name: "2609製造",
      row_no: 5,
      customer_raw: "顧客A",
      product_raw: "製品C",
      process_raw: "プレス加工",
    }
    let actualsUrl: URL | null = null
    server.use(
      http.get(`${API_BASE}/daily-reports/unallocated-actuals`, ({ request }) => {
        actualsUrl = new URL(request.url)
        return HttpResponse.json([actual])
      }),
    )
    render(<DailyReportCoverage />)

    await screen.findByText("600 / 1,000 個")
    await userEvent.click(screen.getByRole("button", { name: /テスト製品C/ }))

    expect(await screen.findByText("プレス加工")).toBeInTheDocument()
    expect(screen.getByText("2609製造 5行目")).toBeInTheDocument()
    expect(Object.fromEntries(actualsUrl!.searchParams)).toEqual({
      product_id: "3",
      process_name: "プレス",
      reason: "no_candidate_order",
      limit: "100",
      months: "3",
    })
  })

  it("期間を変えると、その期間で取り直す（すべては months を付けない）", async () => {
    const requests = mockCoverage()
    render(<DailyReportCoverage />)

    await screen.findByText("600 / 1,000 個")
    await userEvent.click(screen.getByRole("button", { name: "すべて", pressed: false }))

    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1].searchParams.has("months")).toBe(false)
  })

  it("工程ルートが無い製品から工程管理を開ける", async () => {
    mockCoverage()
    server.use(
      http.get(`${API_BASE}/process-routings`, () => HttpResponse.json([])),
      http.get(`${API_BASE}/equipment-groups`, () => HttpResponse.json([])),
      http.get(`${API_BASE}/tenant/members/me`, () =>
        HttpResponse.json({ user_id: "u1", tenant_id: "tenant-1", role: "order_handler" }),
      ),
    )
    render(<DailyReportCoverage />)

    const section = await screen.findByRole("region", { name: /工程ルートが無い製品/ })
    expect(within(section).getByText("日報に出てきた工程: 溶接")).toBeInTheDocument()
    const button = within(section).getByRole("button", { name: "工程を登録" })
    // 製品マスタの読み込み後に押せる
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)

    expect(
      await screen.findByRole("dialog", { name: "工程管理 - テスト製品A" }),
    ).toBeInTheDocument()
  })

  it("一度も集計していなければその旨を出す", async () => {
    mockCoverage({
      ...COVERAGE,
      computed_at: null,
      summary: { ...COVERAGE.summary, unallocated: [] },
      groups: [],
    })
    render(<DailyReportCoverage />)

    expect(await screen.findByText(/まだ集計されていません/)).toBeInTheDocument()
  })
})
