import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { DAILY_REPORT_FORBIDDEN_UI_TEXT } from "@/test-utils/daily-report"
import type { ProductProcessComparison } from "@/types/daily-report-names"
import type { MemberRole } from "@/types/member"
import DailyReportProductProcessPage from "./page"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const replace = vi.fn()
let searchParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  useSearchParams: () => searchParams,
  useParams: () => ({ productId: "1" }),
  usePathname: () => "/master/daily-reports/processes/1",
}))

/**
 * ② 製品の工程を日報に合わせる: 製品の工程ルートと日報の工程の比較（Issue #708）。
 * 製品・表記はダミー値。製品 1（テスト製品A）は MSW の既定の製品マスタにある
 */

const COMPARISON: ProductProcessComparison = {
  product_id: 1,
  product_name: "テスト製品A",
  product_code: "P-001",
  has_routings: true,
  mismatch_count: 3,
  routings: [
    {
      routing_id: 11,
      sequence_order: 1,
      process_name: "プレス",
      untracked: false,
      raws: [{ raw_text: "ﾌﾟﾚｽ加工", entry_count: 12, last_work_date: "2026-11-20" }],
    },
    // 左だけ（日報に出てこない工程）
    { routing_id: 12, sequence_order: 2, process_name: "溶接", untracked: false, raws: [] },
    // 日報で追わない工程で、日報に出てこない（揃っている）
    { routing_id: 13, sequence_order: 3, process_name: "検査", untracked: true, raws: [] },
  ],
  off_routing: [
    {
      process_name: "研磨",
      untracked: false,
      raws: [{ raw_text: "研磨", entry_count: 4, last_work_date: "2026-11-18" }],
    },
  ],
  unmatched: [
    { raw_text: "ﾊﾞﾚﾙ", entry_count: 7, last_work_date: null, other_product_count: 3 },
  ],
}

function mock({
  comparison = COMPARISON,
  role = "order_handler",
}: { comparison?: ProductProcessComparison; role?: MemberRole } = {}) {
  const requests: URL[] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/product-processes/:productId`, ({ request }) => {
      requests.push(new URL(request.url))
      return HttpResponse.json(comparison)
    }),
    http.get(`${API_BASE}/daily-reports/coverage`, () =>
      HttpResponse.json({
        computed_at: "2026-11-25T00:15:00Z",
        since: "2026-09-01",
        summary: {
          total_qty: 0,
          allocated_qty: 0,
          unallocated_qty: 0,
          unmatched_rows: 0,
          unmatched_qty: 0,
          unallocated: [],
        },
        groups: [],
      }),
    ),
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u1", tenant_id: "tenant-1", role }),
    ),
    http.get(`${API_BASE}/daily-reports/process-names`, () =>
      HttpResponse.json(["バレル", "プレス", "研磨", "溶接"]),
    ),
    http.get(`${API_BASE}/equipment-groups`, () => HttpResponse.json([])),
  )
  return requests
}

const routingRow = (name: string) =>
  within(screen.getByRole("list", { name: "工程マスタの工程" })).getByRole("listitem", { name })
const rightOnlyRow = (name: string) =>
  within(screen.getByRole("list", { name: "工程マスタに無い日報の工程" })).getByRole("listitem", {
    name,
  })

beforeEach(() => {
  searchParams = new URLSearchParams()
  replace.mockReset()
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

describe("製品の工程の比較（Issue #708）", () => {
  it("左に工程マスタの工程、右に日報の工程を並べ、結び付く表記は同じ行に揃える", async () => {
    const requests = mock()
    render(<DailyReportProductProcessPage />)

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("テスト製品A（P-001）"),
    )
    expect(screen.getByRole("link", { name: "製品の工程を日報に合わせる" })).toHaveAttribute(
      "href",
      "/master/daily-reports/processes",
    )
    // 既定の期間（直近3か月）
    expect(requests[0].searchParams.get("months")).toBe("3")

    const press = await screen.findByRole("listitem", { name: "1 プレス" })
    expect(press).toHaveTextContent("ﾌﾟﾚｽ加工")
    expect(press).toHaveTextContent("12明細")
    expect(press).not.toHaveAttribute("data-mismatch")
    // 左だけの工程は合わない工程に数えない（一覧の「合わない工程」と揃える）。日報で追わない工程はそのまま揃っている
    expect(routingRow("2 溶接")).not.toHaveAttribute("data-mismatch")
    expect(rightOnlyRow("研磨")).toHaveAttribute("data-mismatch", "true")
    expect(routingRow("3 検査")).toHaveTextContent("日報の対象外")
    expect(routingRow("3 検査")).not.toHaveAttribute("data-mismatch")

    expect(screen.getByRole("heading", { name: /工程マスタに無い日報の工程/ })).toHaveTextContent(
      "2工程",
    )
    expect(rightOnlyRow("研磨")).toHaveTextContent("工程「研磨」")
    expect(rightOnlyRow("ﾊﾞﾚﾙ")).toHaveTextContent("7明細")
  })

  it("受注担当は工程名を選ぶ・対象外・製品の工程に足すができ、日報で追わない工程は設定できない", async () => {
    mock({ role: "order_handler" })
    render(<DailyReportProductProcessPage />)

    await screen.findByRole("listitem", { name: "1 プレス" })
    const barrel = rightOnlyRow("ﾊﾞﾚﾙ")
    expect(within(barrel).getByRole("combobox", { name: "「ﾊﾞﾚﾙ」の工程名を選ぶ" })).toBeInTheDocument()
    expect(within(barrel).getByRole("button", { name: "対象外" })).toBeInTheDocument()
    expect(
      within(rightOnlyRow("研磨")).getByRole("button", { name: "この製品の工程に足す" }),
    ).toBeInTheDocument()
    expect(within(routingRow("2 溶接")).queryByRole("button")).toBeNull()
  })

  it("ISO担当には工程名の結び付けのボタンを出さない", async () => {
    mock({ role: "iso_officer" })
    render(<DailyReportProductProcessPage />)

    await screen.findByRole("listitem", { name: "1 プレス" })
    expect(within(rightOnlyRow("ﾊﾞﾚﾙ")).queryByRole("button")).toBeNull()
    expect(within(rightOnlyRow("ﾊﾞﾚﾙ")).queryByRole("combobox")).toBeNull()
  })

  it("工程名を選ぶと、他の製品の数を添えた確認を経て工程の別名を登録し、揃ったことを知らせる", async () => {
    mock()
    let posted: unknown = null
    server.use(
      http.post(`${API_BASE}/daily-reports/name-aliases/process`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json({ id: "a1" }, { status: 201 })
      }),
    )
    render(<DailyReportProductProcessPage />)

    await screen.findByRole("listitem", { name: "1 プレス" })
    await userEvent.click(
      within(rightOnlyRow("ﾊﾞﾚﾙ")).getByRole("combobox", { name: "「ﾊﾞﾚﾙ」の工程名を選ぶ" }),
    )
    await userEvent.click(await screen.findByRole("option", { name: "プレス" }))
    await userEvent.click(screen.getByRole("button", { name: "決定" }))

    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("この表記は他に3製品の日報でも使われています")
    expect(posted).toBeNull()
    await userEvent.click(within(dialog).getByRole("button", { name: "登録する" }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("日報の「ﾊﾞﾚﾙ」を工程「プレス」に結び付けました", {
        description: "工程マスタと日報の行が揃いました",
      }),
    )
    expect(posted).toEqual({ raw_text: "ﾊﾞﾚﾙ", process_names: ["プレス"] })
  })

  it("工程ルートに無い工程名を選んだときは、揃ったとは知らせない", async () => {
    mock()
    server.use(
      http.post(`${API_BASE}/daily-reports/name-aliases/process`, () =>
        HttpResponse.json({ id: "a1" }, { status: 201 }),
      ),
    )
    render(<DailyReportProductProcessPage />)

    await screen.findByRole("listitem", { name: "1 プレス" })
    await userEvent.click(
      within(rightOnlyRow("ﾊﾞﾚﾙ")).getByRole("combobox", { name: "「ﾊﾞﾚﾙ」の工程名を選ぶ" }),
    )
    await userEvent.click(await screen.findByRole("option", { name: "バレル" }))
    await userEvent.click(screen.getByRole("button", { name: "決定" }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "登録する" }),
    )

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("日報の「ﾊﾞﾚﾙ」を工程「バレル」に結び付けました", {
        description: undefined,
      }),
    )
  })

  it("工程ルートに無い工程は、工程名を入れた工程の編集を開く", async () => {
    mock()
    render(<DailyReportProductProcessPage />)

    await screen.findByRole("listitem", { name: "1 プレス" })
    await userEvent.click(
      within(rightOnlyRow("研磨")).getByRole("button", { name: "この製品の工程に足す" }),
    )
    const dialog = await screen.findByRole("dialog", { name: "工程管理 - テスト製品A" })
    await waitFor(() => expect(within(dialog).getByDisplayValue("研磨")).toBeInTheDocument())
  })

  it("社長は日報に出てこない工程を、確認を経て日報で追わない工程にできる", async () => {
    const requests = mock({ role: "president" })
    let posted: unknown = null
    server.use(
      http.post(`${API_BASE}/untracked-process-names`, async ({ request }) => {
        posted = await request.json()
        return HttpResponse.json(
          { id: 1, process_name: "溶接", created_at: "2026-11-28T00:00:00Z" },
          { status: 201 },
        )
      }),
    )
    render(<DailyReportProductProcessPage />)

    await screen.findByRole("listitem", { name: "1 プレス" })
    await userEvent.click(
      within(routingRow("2 溶接")).getByRole("button", { name: "日報で追わない工程にする" }),
    )
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("工程「溶接」")
    await userEvent.click(within(dialog).getByRole("button", { name: "日報で追わない" }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("工程「溶接」を日報で追わない工程にしました", {
        description: "工程マスタと日報の行が揃いました",
      }),
    )
    expect(posted).toEqual({ process_name: "溶接" })
    // 比較を取り直す
    await waitFor(() => expect(requests.length).toBeGreaterThan(1))
  })

  it("工程ルートが無い製品は、工程を登録するボタンを出す", async () => {
    mock({
      comparison: {
        ...COMPARISON,
        has_routings: false,
        routings: [],
        unmatched: [],
      },
    })
    render(<DailyReportProductProcessPage />)

    expect(await screen.findByText("工程が登録されていません")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "工程を登録する" }))
    expect(
      await screen.findByRole("dialog", { name: "工程管理 - テスト製品A" }),
    ).toBeInTheDocument()
  })

  it("期間は URL から持ち越し、変えると URL を置き換える", async () => {
    searchParams = new URLSearchParams({ months: "all" })
    const requests = mock()
    render(<DailyReportProductProcessPage />)

    await screen.findByRole("listitem", { name: "1 プレス" })
    expect(requests[0].searchParams.has("months")).toBe(false)
    await userEvent.click(screen.getByRole("button", { name: "今月" }))
    expect(replace).toHaveBeenCalledWith("/master/daily-reports/processes/1?months=1")
  })

  it("画面に内部の言葉を出さない", async () => {
    mock({ role: "president" })
    render(<DailyReportProductProcessPage />)

    await screen.findByRole("listitem", { name: "1 プレス" })
    expect(document.body.textContent).not.toMatch(DAILY_REPORT_FORBIDDEN_UI_TEXT)
  })
})
