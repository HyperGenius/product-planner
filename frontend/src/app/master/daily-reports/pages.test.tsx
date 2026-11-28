import type { ComponentType } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { DAILY_REPORT_FORBIDDEN_UI_TEXT } from "@/test-utils/daily-report"
import type {
  DailyReportCoverage as Coverage,
  UnallocatedActual,
  UnallocatedGroup,
} from "@/types/daily-report-progress"
import type { ProductProcessMismatch, UnmatchedName } from "@/types/daily-report-names"
import LegacyCoveragePage from "../daily-report-coverage/page"
import LegacyNamesPage from "../daily-report-names/page"
import DailyReportAliasesPage from "./aliases/page"
import DailyReportCustomersPage from "./customers/page"
import DailyReportHubPage from "./page"
import DailyReportProcessesPage from "./processes/page"
import DailyReportProductsPage from "./products/page"
import DailyReportStockPage from "./stock/page"
import DailyReportUnorderedPage from "./unordered/page"

const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/master/daily-reports",
}))

/**
 * 日報の実績のハブと各ページ（Issue #707）。製品・顧客・表記はダミー値（実データを含めない）。
 * 製品 1（テスト製品A）は MSW の既定の製品マスタにある。
 */

function name(overrides: Partial<UnmatchedName>): UnmatchedName {
  return {
    kind: "product",
    raw_text: "ピンA",
    customer_raw: "顧客A",
    customer_id: 10,
    entry_count: 1,
    last_work_date: "2026-11-01",
    ...overrides,
  }
}

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
    other_customer_orders: [],
    ...overrides,
  }
}

const NAMES: UnmatchedName[] = [
  name({ kind: "customer", raw_text: "顧客X", customer_raw: null, customer_id: null }),
  name({ raw_text: "ピンX", customer_raw: "顧客X", customer_id: null }),
  name({ raw_text: "ピンZ", customer_raw: null, customer_id: null }),
  name({ raw_text: "ピンA", entry_count: 30 }),
  name({ raw_text: "ピンB", entry_count: 5 }),
  name({ kind: "process", raw_text: "ﾌﾟﾚｽ加工", customer_raw: null, customer_id: null }),
  name({ kind: "equipment", raw_text: "200t 1号機", customer_raw: null, customer_id: null }),
]

const COVERAGE: Coverage = {
  computed_at: "2026-11-25T00:15:00Z",
  since: "2026-09-01",
  summary: {
    total_qty: 1000,
    allocated_qty: 600,
    unallocated_qty: 300,
    unmatched_rows: 4,
    unmatched_qty: 100,
    unallocated: [],
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
    group({ product_id: 3, product_name: "テスト製品C", product_code: null, qty: 20 }),
  ],
}

/** ② 工程ルートと日報の工程が合わない製品（Issue #708） */
const PRODUCT_PROCESSES: ProductProcessMismatch[] = [
  {
    product_id: 1,
    product_name: "テスト製品A",
    product_code: "P-001",
    has_routings: false,
    mismatch_count: 2,
    entry_count: 12,
  },
]

function mockSources({
  names = NAMES,
  coverage = COVERAGE,
  productProcesses = PRODUCT_PROCESSES,
}: { names?: UnmatchedName[]; coverage?: Coverage; productProcesses?: ProductProcessMismatch[] } = {}) {
  const coverageRequests: URL[] = []
  const productProcessRequests: URL[] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/unmatched-names`, () => HttpResponse.json(names)),
    http.get(`${API_BASE}/daily-reports/coverage`, ({ request }) => {
      coverageRequests.push(new URL(request.url))
      return HttpResponse.json(coverage)
    }),
    http.get(`${API_BASE}/daily-reports/product-processes`, ({ request }) => {
      productProcessRequests.push(new URL(request.url))
      return HttpResponse.json(productProcesses)
    }),
  )
  return Object.assign(coverageRequests, { productProcessRequests })
}

const getPageHeading = () => screen.getByRole("heading", { level: 1 })

beforeEach(() => {
  replace.mockReset()
  window.location.hash = ""
  server.use(
    http.get(`${API_BASE}/daily-reports/stock-estimates`, () =>
      HttpResponse.json({
        computed_at: null,
        items: [
          {
            product_id: 1,
            product_name: "テスト製品A",
            product_code: "P-001",
            process_name: "プレス",
            next_process_name: "溶接",
            qty: 40,
            last_movement_date: "2026-11-20",
          },
          {
            product_id: 1,
            product_name: "テスト製品A",
            product_code: "P-001",
            process_name: "溶接",
            next_process_name: null,
            qty: 10,
            last_movement_date: "2026-11-21",
          },
        ],
        feedback: [],
      }),
    ),
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u1", tenant_id: "tenant-1", role: "order_handler" }),
    ),
    // 行の結び付け先のマスタ・候補（行の操作は unmatched-name-list.test.tsx で見る）
    http.get(`${API_BASE}/daily-reports/product-candidates`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/daily-reports/process-names`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/daily-reports/name-aliases/:kind`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/equipments`, () => HttpResponse.json([])),
  )
})

describe("日報の実績のハブ（Issue #707）", () => {
  it("前提・①②③を依存関係の順に並べ、件数に単位を付ける", async () => {
    const requests = mockSources()
    render(<DailyReportHubPage />)

    const queue = await screen.findByRole("navigation", { name: "日報の実績の作業" })
    await waitFor(() =>
      expect(within(queue).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual([
        "① 日報の製品をつなぐ 2品名",
        "② 製品の工程を日報に合わせる 1製品",
        "③ 受注の無い製造を確かめる 2件",
      ]),
    )
    expect(within(queue).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "/master/daily-reports/products",
      "/master/daily-reports/processes",
      "/master/daily-reports/unordered",
    ])
    // ②③は既定の期間（直近3か月）で数える
    expect(requests[0].searchParams.get("months")).toBe("3")
    expect(requests.productProcessRequests[0].searchParams.get("months")).toBe("3")

    const banner = screen.getByRole("region", { name: "先に片付けること" })
    expect(banner).toHaveTextContent("日報の顧客先のうち1顧客先がアプリに未登録です")
    // 未登録の顧客先の製品（ピンX）は顧客先のまとまりの中に出すので、ここでは空欄の製品だけを数える（#703）
    expect(banner).toHaveTextContent("顧客先が空欄・対象外の日報の製品が1品名あります")
    expect(within(banner).getByRole("link", { name: "顧客を選ぶ" })).toHaveAttribute(
      "href",
      "/master/daily-reports/customers",
    )
    // データの鮮度（JST）
    expect(screen.getByText("日報 11/25 09:15")).toBeInTheDocument()
  })

  it("設備はハブに出さない", async () => {
    mockSources()
    render(<DailyReportHubPage />)

    await screen.findByRole("link", { name: /^① 日報の製品をつなぐ 2品名/ })
    expect(screen.queryByText(/設備/)).toBeNull()
  })

  it("参考に作り置き・結び付いた割合・登録済みの対応付けを置く", async () => {
    mockSources()
    render(<DailyReportHubPage />)

    const reference = await screen.findByRole("region", { name: "参考" })
    // 同じ製品の2工程の推定は1製品
    expect(
      await within(reference).findByRole("link", { name: "作り置き（推定） 1製品" }),
    ).toHaveAttribute("href", "/master/daily-reports/stock")
    expect(within(reference).getByText("60%")).toBeInTheDocument()
    expect(within(reference).getByText("600 / 1,000個")).toBeInTheDocument()
    expect(
      within(reference).getByRole("link", { name: "登録済みの対応付け・対象外" }),
    ).toHaveAttribute("href", "/master/daily-reports/aliases")
  })

  it("作業が0件のキューは消さずに「済み」と小さく出し、前提が無ければバナーを出さない", async () => {
    mockSources({
      names: [name({ kind: "equipment", raw_text: "200t 1号機", customer_raw: null, customer_id: null })],
      coverage: { ...COVERAGE, groups: [] },
      productProcesses: [],
    })
    render(<DailyReportHubPage />)

    expect(
      await screen.findByRole("link", { name: "① 日報の製品をつなぐ 済み" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "② 製品の工程を日報に合わせる 済み" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "③ 受注の無い製造を確かめる 済み" })).toBeInTheDocument()
    expect(screen.queryByRole("region", { name: "先に片付けること" })).toBeNull()
  })

  it("取得中は件数を「－」、失敗は「取得できませんでした」にする", async () => {
    server.use(
      http.get(`${API_BASE}/daily-reports/unmatched-names`, () =>
        HttpResponse.json({ detail: "error" }, { status: 500 }),
      ),
      http.get(`${API_BASE}/daily-reports/coverage`, () => new Promise(() => {})),
    )
    render(<DailyReportHubPage />)

    expect(
      await screen.findByRole("link", { name: "① 日報の製品をつなぐ 取得できませんでした" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "③ 受注の無い製造を確かめる －" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("日報の表記を取得できませんでした")
  })

  it("画面に内部の言葉・仕組みの説明を出さず、ヘルプに置く", async () => {
    mockSources()
    render(<DailyReportHubPage />)

    await screen.findByRole("link", { name: /^① 日報の製品をつなぐ 2品名/ })
    expect(document.body.textContent).not.toMatch(DAILY_REPORT_FORBIDDEN_UI_TEXT)

    await userEvent.click(screen.getByRole("button", { name: "ヘルプを開く" }))
    const help = await screen.findByRole("dialog", { name: "日報の実績" })
    expect(within(help).getByText(/前提 → ① → ② → ③/)).toBeInTheDocument()
    // 各ページの行・ダイアログから外した説明（Issue #702）
    expect(within(help).getByText(/過去・今後の日報にも反映されます/)).toBeInTheDocument()
    expect(within(help).getByText(/10〜15分ごとに集計します/)).toBeInTheDocument()
    expect(within(help).getByText(/製品は顧客ごとに結び付けます/)).toBeInTheDocument()
    expect(within(help).getByText(/明細の多い順に並べています/)).toBeInTheDocument()
    expect(within(help).getByText(/承認前（下書き・承認待ち）の受注には/)).toBeInTheDocument()
    expect(within(help).getByText(/「対象外」タブの「戻す」/)).toBeInTheDocument()
  })
})

describe("日報の実績の各ページ（Issue #707）", () => {
  const PAGES: [string, ComponentType][] = [
    ["日報の顧客先", DailyReportCustomersPage],
    ["① 日報の製品をつなぐ", DailyReportProductsPage],
    ["② 製品の工程を日報に合わせる", DailyReportProcessesPage],
    ["③ 受注の無い製造を確かめる", DailyReportUnorderedPage],
    ["作り置き（推定）", DailyReportStockPage],
    ["登録済みの対応付け・対象外", DailyReportAliasesPage],
  ]

  it.each(PAGES)("%s: ハブへ戻れて、データの鮮度を出す", async (title, Page) => {
    mockSources()
    render(<Page />)

    await waitFor(() => expect(getPageHeading()).toHaveTextContent(title))
    expect(screen.getByRole("link", { name: "日報の実績" })).toHaveAttribute(
      "href",
      "/master/daily-reports",
    )
    expect(await screen.findByText("日報 11/25 09:15")).toBeInTheDocument()
  })

  it.each(PAGES)("%s: 画面に内部の言葉を出さない（Issue #702）", async (title, Page) => {
    mockSources()
    render(<Page />)

    await waitFor(() => expect(getPageHeading()).toHaveTextContent(title))
    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument())
    expect(document.body.textContent).not.toMatch(DAILY_REPORT_FORBIDDEN_UI_TEXT)
  })

  it("前提: 未登録の顧客先ごとに製品をまとめ、空欄の製品は別に出す（バナーと同じ件数、#703）", async () => {
    mockSources()
    render(<DailyReportCustomersPage />)

    await waitFor(() => expect(getPageHeading()).toHaveTextContent("日報の顧客先1顧客先"))
    const customer = await screen.findByRole("region", { name: "顧客先「顧客X」" })
    expect(within(customer).getByRole("button", { name: "顧客X" })).toBeInTheDocument()
    expect(within(customer).getByRole("button", { name: "ピンX" })).toBeInTheDocument()
    const products = screen.getByRole("region", { name: /顧客先が空欄・対象外の日報の製品/ })
    expect(within(products).getByRole("heading", { level: 2 })).toHaveTextContent("1品名")
    expect(within(products).getByRole("button", { name: "ピンZ" })).toBeInTheDocument()
  })

  it("①: 顧客先が決まった日報の製品だけを、ハブと同じ件数で出す", async () => {
    mockSources()
    render(<DailyReportProductsPage />)

    await waitFor(() => expect(getPageHeading()).toHaveTextContent("① 日報の製品をつなぐ2品名"))
    await screen.findByRole("button", { name: "ピンA" })
    const rows = within(screen.getByRole("list")).getAllByRole("button", { expanded: false })
    expect(rows.map((r) => r.textContent)).toEqual(["ピンA", "ピンB"])
  })

  it("②: 工程ルートと日報の工程が合わない製品を、ハブと同じ件数で出し、製品の比較へ移る（#708）", async () => {
    mockSources()
    render(<DailyReportProcessesPage />)

    await waitFor(() =>
      expect(getPageHeading()).toHaveTextContent("② 製品の工程を日報に合わせる1製品"),
    )
    const [row] = await screen.findAllByTestId("product-process-row")
    expect(row).toHaveAttribute("href", "/master/daily-reports/processes/1")
    expect(within(row).getByText("テスト製品A（P-001）")).toBeInTheDocument()
    expect(within(row).getByText("工程ルートなし")).toBeInTheDocument()
    expect(row).toHaveTextContent("合わない工程 2")
    expect(row).toHaveTextContent("12明細")
    // 旧名寄せの「工程」（工程マスタに無い日報の工程名の一覧）は製品の比較に移した
    expect(screen.queryByRole("button", { name: "ﾌﾟﾚｽ加工" })).toBeNull()
  })

  it("②: 期間を変えると取り直し、製品の比較へ期間を持ち越す", async () => {
    const requests = mockSources()
    render(<DailyReportProcessesPage />)

    await screen.findAllByTestId("product-process-row")
    await userEvent.click(screen.getByRole("button", { name: "すべて" }))
    await waitFor(() =>
      expect(requests.productProcessRequests.at(-1)?.searchParams.has("months")).toBe(false),
    )
    await waitFor(() =>
      expect(screen.getAllByTestId("product-process-row")[0]).toHaveAttribute(
        "href",
        "/master/daily-reports/processes/1?months=all",
      ),
    )
  })

  it("③: 工程に関する未割当を除いたまとめを、既定は「すべて」で出す（ハブと同じ件数）", async () => {
    mockSources()
    render(<DailyReportUnorderedPage />)

    await waitFor(() =>
      expect(getPageHeading()).toHaveTextContent("③ 受注の無い製造を確かめる2件"),
    )
    const region = await screen.findByRole("region", { name: "受注の無い製造" })
    const rows = within(region)
      .getAllByRole("button", { expanded: false })
      .map((b) => b.textContent)
    expect(rows).toEqual([
      expect.stringContaining("テスト製品B"),
      expect.stringContaining("テスト製品C"),
    ])
    expect(screen.getByRole("button", { name: /^すべて\s*2$/, pressed: true })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /^要確認\s*1$/ }))
    // 絞り込みを変えると一覧を作り直すので、領域を引き直す
    expect(
      within(screen.getByRole("region", { name: "受注の無い製造" }))
        .getAllByRole("button", { expanded: false })
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining("テスト製品C")])
  })

  it("③: 別の顧客の受注ありは、問いかけと該当の受注へのリンクを出す", async () => {
    mockSources({
      coverage: {
        ...COVERAGE,
        groups: [
          group({
            category: "other_customer_order",
            qty: 50,
            other_customer_orders: [
              { id: 77, order_number: "A-77", customer_name: "顧客B" },
              { id: 78, order_number: null, customer_name: null },
            ],
          }),
        ],
      },
    })
    render(<DailyReportUnorderedPage />)

    expect(
      await screen.findByText(/日報の顧客先と別の顧客に同じ製品の受注があります。顧客先の書き間違い？/),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "顧客B・A-77" })).toHaveAttribute("href", "/orders/77")
    expect(screen.getByRole("link", { name: "顧客不明・#78" })).toHaveAttribute(
      "href",
      "/orders/78",
    )
  })

  it("③: 行を開くと、製品・工程名・理由・期間で絞り込んだ元の日報の行を出す", async () => {
    mockSources()
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
    render(<DailyReportUnorderedPage />)

    await userEvent.click(await screen.findByRole("button", { name: /テスト製品C/ }))
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

  it("③: 期間を変えると、その期間で取り直す（すべては months を付けない）", async () => {
    const requests = mockSources()
    render(<DailyReportUnorderedPage />)

    const period = await screen.findByRole("group", { name: "加工日の期間" })
    await screen.findByRole("region", { name: "受注の無い製造" })
    await userEvent.click(within(period).getByRole("button", { name: "すべて" }))

    await waitFor(() => expect(requests.some((r) => !r.searchParams.has("months"))).toBe(true))
  })

  it("登録済みの対応付け: 日報の設備（ハブに数えない）をタブで出す", async () => {
    mockSources()
    render(<DailyReportAliasesPage />)

    await userEvent.click(await screen.findByRole("tab", { name: "日報の設備" }))
    expect(await screen.findByRole("button", { name: "200t 1号機" })).toBeInTheDocument()
  })
})

describe("旧 URL（Issue #707）", () => {
  it("旧「日報の名寄せ」はハブへ移す", async () => {
    render(<LegacyNamesPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/master/daily-reports"))
  })

  it.each([
    ["#unallocated", "/master/daily-reports/unordered"],
    ["#routing", "/master/daily-reports/processes"],
    ["#stock", "/master/daily-reports/stock"],
    ["#unmatched", "/master/daily-reports"],
    ["", "/master/daily-reports"],
  ])("旧「日報の照合状況」%s は %s へ移す", async (hash, href) => {
    window.location.hash = hash
    render(<LegacyCoveragePage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith(href))
  })
})
