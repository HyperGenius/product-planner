import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { DAILY_REPORT_FORBIDDEN_UI_TEXT } from "@/test-utils/daily-report"
import type { UnmatchedName } from "@/types/daily-report-names"
import DailyReportCustomersPage from "@/app/master/daily-reports/customers/page"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/master/daily-reports/customers",
}))

/**
 * 前提のページの顧客先のまとまり（Issue #703）。顧客先・製品はダミー値（実データを含めない）。
 * 顧客 1（テスト顧客A）は MSW の既定の顧客マスタにある
 */

function name(overrides: Partial<UnmatchedName>): UnmatchedName {
  return {
    kind: "product",
    raw_text: "ピンA",
    customer_raw: null,
    customer_id: null,
    entry_count: 1,
    last_work_date: "2026-11-01",
    ...overrides,
  }
}

const NAMES: UnmatchedName[] = [
  name({ kind: "customer", raw_text: "顧客X", entry_count: 20 }),
  name({ kind: "customer", raw_text: "顧客Y", entry_count: 3 }),
  name({ raw_text: "ピン1", customer_raw: "顧客X", entry_count: 12 }),
  name({ raw_text: "ピン2", customer_raw: "顧客X", entry_count: 5 }),
  name({ raw_text: "ピン3", customer_raw: null, entry_count: 4 }),
  name({ raw_text: "ピン4", customer_raw: "社内", entry_count: 2 }),
  // ①（顧客先が決まっている）はこのページに出さない
  name({ raw_text: "ピン5", customer_raw: "顧客A", customer_id: 1, entry_count: 30 }),
]

/** 表記の一覧を返す。顧客の別名が登録されたら、その顧客先と製品の顧客先を決まった状態にする */
function mockNames(initial: UnmatchedName[] = NAMES) {
  let items = initial
  const posts: { path: string; body: unknown }[] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/unmatched-names`, () => HttpResponse.json(items)),
    http.get(`${API_BASE}/daily-reports/coverage`, () =>
      HttpResponse.json({ computed_at: null, since: null, summary: null, groups: [] }),
    ),
    http.get(`${API_BASE}/daily-reports/stock-estimates`, () =>
      HttpResponse.json({ computed_at: null, items: [], feedback: [] }),
    ),
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u1", tenant_id: "tenant-1", role: "order_handler" }),
    ),
    http.get(`${API_BASE}/daily-reports/product-candidates`, () => HttpResponse.json([])),
    http.post(`${API_BASE}/daily-reports/name-aliases/customer`, async ({ request }) => {
      const body = (await request.json()) as { raw_text: string; customer_id: number }
      posts.push({ path: new URL(request.url).pathname, body })
      items = items
        .filter((i) => !(i.kind === "customer" && i.raw_text === body.raw_text))
        .map((i) =>
          i.kind === "product" && i.customer_raw === body.raw_text
            ? { ...i, customer_id: body.customer_id }
            : i,
        )
      return HttpResponse.json({ id: "alias-1", ...body }, { status: 201 })
    }),
  )
  return posts
}

const groupOf = (customerRaw: string) =>
  screen.getByRole("region", { name: `顧客先「${customerRaw}」` })

beforeEach(() => {
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
  push.mockReset()
})

describe("前提のページの顧客先のまとまり（Issue #703）", () => {
  it("未登録の顧客先ごとに製品をまとめ、見出しに品名の数を出す（件数はまとまりの数）", async () => {
    mockNames()
    render(<DailyReportCustomersPage />)

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("日報の顧客先2顧客先"),
    )
    await screen.findByRole("region", { name: "顧客先「顧客X」" })
    const x = groupOf("顧客X")
    expect(within(x).getByText("2品名")).toBeInTheDocument()
    const products = within(x).getByRole("list", { name: "日報の製品" })
    expect(
      within(products)
        .getAllByRole("button", { expanded: false })
        .map((b) => b.textContent),
    ).toEqual(["ピン1", "ピン2"])
    // 製品が無い顧客先もまとまりとして出す
    expect(within(groupOf("顧客Y")).getByText("0品名")).toBeInTheDocument()
    expect(within(groupOf("顧客Y")).queryByRole("list", { name: "日報の製品" })).toBeNull()
    // ①の製品は出さない
    expect(screen.queryByRole("button", { name: "ピン5" })).not.toBeInTheDocument()
  })

  it("まとまりの製品の行には顧客先・文章を出さず、操作は対象外だけ", async () => {
    mockNames()
    render(<DailyReportCustomersPage />)

    await screen.findByRole("region", { name: "顧客先「顧客X」" })
    const products = within(groupOf("顧客X")).getByRole("list", { name: "日報の製品" })
    expect(within(products).queryByText(/顧客先/)).not.toBeInTheDocument()
    expect(within(products).queryByRole("combobox")).not.toBeInTheDocument()
    expect(
      within(products)
        .getAllByRole("button", { name: /を対象外にする$/ })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["「ピン1」を対象外にする", "「ピン2」を対象外にする"])
    // 顧客を選ぶのはまとまりに1つだけ
    expect(
      within(groupOf("顧客X")).getAllByRole("combobox", { name: "「顧客X」の顧客を選択" }),
    ).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(DAILY_REPORT_FORBIDDEN_UI_TEXT)
    expect(document.body.textContent).not.toMatch(/を先に「顧客」で対応付けてください/)
  })

  it("顧客先が空欄・対象外にした顧客先の製品は別にまとめ、対象外にだけできる", async () => {
    mockNames()
    render(<DailyReportCustomersPage />)

    const section = await screen.findByRole("region", {
      name: /顧客先が空欄・対象外の日報の製品/,
    })
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("2品名")
    const blank = within(section).getByRole("region", { name: "顧客先が空欄" })
    expect(within(blank).getByRole("button", { name: "ピン3" })).toBeInTheDocument()
    const ignored = within(section).getByRole("region", { name: "対象外にした顧客先「社内」" })
    expect(within(ignored).getByRole("button", { name: "ピン4" })).toBeInTheDocument()
    expect(within(section).queryByRole("combobox")).not.toBeInTheDocument()
    expect(
      within(section).getByRole("button", { name: "「ピン3」を対象外にする" }),
    ).toBeInTheDocument()
  })

  it("顧客を選ぶと確認を経て顧客の別名を登録し、まとまりが消えて品名の数をトーストで知らせる", async () => {
    const posts = mockNames()
    render(<DailyReportCustomersPage />)

    await screen.findByRole("region", { name: "顧客先「顧客X」" })
    const trigger = within(groupOf("顧客X")).getByRole("combobox", {
      name: "「顧客X」の顧客を選択",
    })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole("option", { name: /テスト顧客A/ }))
    // 選んだ時点では登録しない（Issue #645）
    expect(posts).toEqual([])
    const dialog = await screen.findByRole("alertdialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "登録する" }))

    await waitFor(() =>
      expect(posts).toEqual([
        {
          path: "/daily-reports/name-aliases/customer",
          body: { raw_text: "顧客X", customer_id: 1 },
        },
      ]),
    )
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "顧客先「顧客X」" })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("日報の顧客先1顧客先")
    expect(screen.queryByRole("button", { name: "ピン1" })).not.toBeInTheDocument()

    const [message, options] = vi.mocked(toast.success).mock.calls[0]
    expect(message).toBe("顧客先「顧客X」をテスト顧客Aに結び付けました")
    expect(options).toMatchObject({
      description: "2品名を製品に結び付けられるようになりました",
      action: { label: "日報の製品をつなぐ" },
    })
    // トーストから①のページへ移れる
    const action = (options as { action: { label: string; onClick: () => void } }).action
    action.onClick()
    expect(push).toHaveBeenCalledWith("/master/daily-reports/products")
  })

  it("製品の行が無い顧客先を結び付けたときは、品名の数を出さない", async () => {
    mockNames()
    render(<DailyReportCustomersPage />)

    await screen.findByRole("region", { name: "顧客先「顧客Y」" })
    const trigger = within(groupOf("顧客Y")).getByRole("combobox", {
      name: "「顧客Y」の顧客を選択",
    })
    await waitFor(() => expect(trigger).toBeEnabled())
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole("option", { name: /テスト顧客A/ }))
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "登録する" }),
    )

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("顧客先「顧客Y」をテスト顧客Aに結び付けました"),
    )
  })

  it("書き込めないロールにはボタンを出さない", async () => {
    mockNames()
    server.use(
      http.get(`${API_BASE}/tenant/members/me`, () =>
        HttpResponse.json({ user_id: "u1", tenant_id: "tenant-1", role: "iso_officer" }),
      ),
    )
    render(<DailyReportCustomersPage />)

    await screen.findByRole("region", { name: "顧客先「顧客X」" })
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /を対象外にする$/ })).not.toBeInTheDocument()
  })
})
