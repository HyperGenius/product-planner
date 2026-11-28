import { test, expect, type Page, type Route } from "@playwright/test"

/**
 * 日報の実績のハブと各ページ（Issue #707）の見た目を撮る。
 *
 * 前提:
 * - Supabase (supabase start) と frontend (npm run dev) がローカルで起動していること
 * - E2E_USER_EMAIL / E2E_USER_PASSWORD のユーザーでログインできること
 *
 * バックエンドの API（`NEXT_PUBLIC_API_URL` の localhost:8000）はすべて page.route() で固定応答にするので、
 * backend は起動しなくてよい。顧客・製品・日報の表記はダミー値。
 *
 * スクリーンショットは test-results/daily-report-hub/ に保存する（gitignore 済み）。
 * 1920×1080 とタブレット横向き（1180×820）で撮る。
 */
const email = process.env.E2E_USER_EMAIL ?? "test@example.com"
const password = process.env.E2E_USER_PASSWORD ?? "Test123!"

test.use({ timezoneId: "Asia/Tokyo" })

const PRODUCTS = [
  { id: 101, name: "ブラケットA", code: "DW-101", is_active: true, has_process: true },
  { id: 102, name: "シャフトB", code: "DW-102", is_active: true, has_process: false },
  { id: 103, name: "カバーC", code: "DW-103", is_active: true, has_process: true },
  { id: 104, name: "ピンD", code: "DW-104", is_active: true, has_process: true },
]

function unmatched(kind: string, raw_text: string, fields: Record<string, unknown> = {}) {
  return {
    kind,
    raw_text,
    customer_raw: null,
    customer_id: null,
    entry_count: 3,
    last_work_date: "2026-11-21",
    ...fields,
  }
}

const UNMATCHED_NAMES = [
  unmatched("customer", "見本商事", { entry_count: 12 }),
  unmatched("customer", "テスト工業(株)", { entry_count: 4 }),
  // 顧客先が決まっていない製品（前提）
  unmatched("product", "ブラケット改", { customer_raw: "見本商事", entry_count: 8 }),
  unmatched("product", "試作品", { entry_count: 1 }),
  // ① 顧客先が決まっている製品
  unmatched("product", "ﾌﾞﾗｹｯﾄA", { customer_raw: "サンプル", customer_id: 1, entry_count: 20 }),
  unmatched("product", "シャフト B-2", { customer_raw: "サンプル", customer_id: 1, entry_count: 9 }),
  unmatched("product", "カバー(C)", { customer_raw: "テスト精機", customer_id: 2, entry_count: 2 }),
  // ② 工程名
  unmatched("process", "ﾌﾟﾚｽ加工", { entry_count: 15 }),
  // 設備（ハブに出さない）
  unmatched("equipment", "200t 3号機", { entry_count: 6 }),
]

function group(fields: Record<string, unknown>) {
  return {
    product_id: 101,
    product_name: "ブラケットA",
    product_code: "DW-101",
    product_has_routings: true,
    process_name: "プレス",
    reason: "no_candidate_order",
    category: "no_order",
    row_count: 2,
    qty: 100,
    first_work_date: "2026-11-01",
    last_work_date: "2026-11-20",
    customer_names: ["サンプル"],
    other_customer_orders: [],
    ...fields,
  }
}

const COVERAGE = {
  computed_at: "2026-11-25T00:15:00Z",
  since: "2026-09-01",
  summary: {
    total_qty: 12000,
    allocated_qty: 8400,
    unallocated_qty: 2600,
    unmatched_rows: 40,
    unmatched_qty: 1000,
    unallocated: [],
  },
  groups: [
    // ② 工程ルートが無い製品
    group({ product_id: 102, product_name: "シャフトB", product_code: "DW-102", product_has_routings: false, process_name: "旋盤", reason: "no_routing_process", category: "no_routing_process", qty: 900, row_count: 12 }),
    group({ product_id: 102, product_name: "シャフトB", product_code: "DW-102", product_has_routings: false, process_name: "研磨", reason: "no_routing_process", category: "no_routing_process", qty: 300, row_count: 4 }),
    // ② 工程ルートに無い工程・日報で追わない工程
    group({ product_id: 103, product_name: "カバーC", product_code: "DW-103", process_name: "溶接", reason: "no_routing_process", category: "no_routing_process", qty: 400, row_count: 5 }),
    group({ product_id: 103, product_name: "カバーC", product_code: "DW-103", process_name: "検査", reason: "untracked_process", category: "untracked_process", qty: 60, row_count: 2 }),
    // ③
    group({ qty: 500, row_count: 6 }),
    group({ product_id: 104, product_name: "ピンD", product_code: "DW-104", category: "other_customer_order", qty: 240, other_customer_orders: [{ id: 7, order_number: "S-0007", customer_name: "テスト精機" }] }),
    group({ product_id: 104, product_name: "ピンD", product_code: "DW-104", process_name: "カシメ", reason: "before_order_date", category: "stocked", qty: 120 }),
    group({ product_id: 103, product_name: "カバーC", product_code: "DW-103", category: "closed_order_only", qty: 80 }),
  ],
}

const STOCK = {
  computed_at: "2026-11-25T00:15:00Z",
  items: [
    { product_id: 104, product_name: "ピンD", product_code: "DW-104", process_name: "カシメ", next_process_name: "検査", qty: 120, last_movement_date: "2026-11-20" },
    { product_id: 101, product_name: "ブラケットA", product_code: "DW-101", process_name: "プレス", next_process_name: null, qty: 300, last_movement_date: "2026-11-18" },
  ],
  feedback: [],
}

/** localhost:8000 の API をすべて固定応答にする（知らないパスは空の一覧） */
async function mockApi(page: Page, overrides: { names?: unknown[]; coverage?: unknown } = {}) {
  await page.route(/^http:\/\/localhost:8000\//, (route: Route) => {
    const path = new URL(route.request().url()).pathname
    const json = (body: unknown) => route.fulfill({ json: body })
    if (path === "/tenant/members/me")
      return json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role: "president" })
    if (path === "/products") return json(PRODUCTS)
    if (path === "/daily-reports/unmatched-names") return json(overrides.names ?? UNMATCHED_NAMES)
    if (path === "/daily-reports/coverage") return json(overrides.coverage ?? COVERAGE)
    if (path === "/daily-reports/stock-estimates") return json(STOCK)
    return json([])
  })
}

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 })
}

async function screenshot(page: Page, name: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
  await page.screenshot({ path: `test-results/daily-report-hub/${name}.png` })
}

async function open(page: Page, path: string, overrides?: Parameters<typeof mockApi>[1]) {
  await mockApi(page, overrides)
  await login(page)
  await page.goto(path)
}

test.describe("日報の実績のハブと各ページ（Issue #707）", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
  })

  test("ハブ: 前提バナー・作業のキュー・参考", async ({ page }) => {
    await open(page, "/master/daily-reports")
    await expect(page.getByRole("link", { name: "① 日報の製品をつなぐ 3品名" })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole("link", { name: "② 製品の工程を日報に合わせる 2製品 日報の工程名 1工程名" })).toBeVisible()
    await expect(page.getByRole("link", { name: "③ 受注の無い製造を確かめる 4件" })).toBeVisible()
    await expect(page.getByRole("region", { name: "先に片付けること" })).toContainText(
      "日報の顧客先のうち2顧客先がアプリに未登録です",
    )
    await expect(page.getByRole("link", { name: "作り置き（推定） 2製品" })).toBeVisible()
    // マスタのタブは1つにまとまり、選択中になる
    await expect(page.getByRole("link", { name: "日報の名寄せ" })).toHaveCount(0)
    await screenshot(page, "hub-1920")
  })

  test("ハブ: 作業が無くなったキューは小さく「済み」と出す", async ({ page }) => {
    await open(page, "/master/daily-reports", {
      names: [unmatched("equipment", "200t 3号機")],
      coverage: { ...COVERAGE, groups: COVERAGE.groups.filter((g) => g.category !== "no_routing_process" && g.category !== "untracked_process") },
    })
    await expect(page.getByRole("link", { name: "① 日報の製品をつなぐ 済み" })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole("link", { name: "② 製品の工程を日報に合わせる 済み" })).toBeVisible()
    await expect(page.getByRole("region", { name: "先に片付けること" })).toHaveCount(0)
    await screenshot(page, "hub-done-1920")
  })

  test("前提: 日報の顧客先（バナーから開く）", async ({ page }) => {
    await open(page, "/master/daily-reports")
    await page.getByRole("link", { name: "顧客を選ぶ" }).click({ timeout: 30000 })
    await expect(page).toHaveURL(/\/master\/daily-reports\/customers$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("2顧客先")
    // 未登録の顧客先ごとに製品をまとめる（#703）
    const group = page.getByRole("region", { name: "顧客先「見本商事」" })
    await expect(group).toContainText("1品名")
    await expect(group.getByRole("list", { name: "日報の製品" })).toContainText("ブラケット改")
    await expect(page.getByRole("region", { name: "顧客先「テスト工業(株)」" })).toContainText("0品名")
    await expect(page.getByRole("region", { name: "顧客先が空欄", exact: true })).toContainText("試作品")
    await screenshot(page, "customers-1920")
  })

  test("① 日報の製品をつなぐ（ハブから開く）", async ({ page }) => {
    await open(page, "/master/daily-reports")
    await page.getByRole("link", { name: /^① 日報の製品をつなぐ/ }).click({ timeout: 30000 })
    await expect(page).toHaveURL(/\/master\/daily-reports\/products$/)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("3品名")
    await expect(page.getByRole("list").filter({ hasText: "ﾌﾞﾗｹｯﾄA" }).getByRole("button", { expanded: false })).toHaveText([
      "ﾌﾞﾗｹｯﾄA",
      "シャフト B-2",
      "カバー(C)",
    ])
    await screenshot(page, "products-1920")
  })

  test("② 製品の工程を日報に合わせる", async ({ page }) => {
    await open(page, "/master/daily-reports/processes")
    await expect(page.getByTestId("process-product-row")).toHaveCount(2, { timeout: 30000 })
    await expect(page.getByRole("heading", { level: 1 })).toContainText("2製品")
    await screenshot(page, "processes-1920")
  })

  test("③ 受注の無い製造を確かめる", async ({ page }) => {
    await open(page, "/master/daily-reports/unordered")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("4件", { timeout: 30000 })
    await expect(page.getByRole("region", { name: "受注の無い製造" }).getByRole("listitem")).toHaveCount(4)
    await screenshot(page, "unordered-1920")
  })

  test("作り置き（推定）", async ({ page }) => {
    await open(page, "/master/daily-reports/stock")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("2製品", { timeout: 30000 })
    await screenshot(page, "stock-1920")
  })

  test("登録済みの対応付け・対象外（日報の設備）", async ({ page }) => {
    await open(page, "/master/daily-reports/aliases")
    await page.getByRole("tab", { name: "日報の設備" }).click({ timeout: 30000 })
    await expect(page.getByRole("button", { name: "200t 3号機", exact: true })).toBeVisible()
    await screenshot(page, "aliases-equipment-1920")
  })

  test("旧 URL: 照合状況の #routing は②へ、名寄せはハブへ移る", async ({ page }) => {
    await open(page, "/master/daily-report-coverage#routing")
    await expect(page).toHaveURL(/\/master\/daily-reports\/processes$/, { timeout: 30000 })
    await page.goto("/master/daily-report-names")
    await expect(page).toHaveURL(/\/master\/daily-reports$/, { timeout: 30000 })
  })

  test("ハブ・前提・② をタブレット横向き（1180×820）で", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await open(page, "/master/daily-reports")
    await expect(page.getByRole("link", { name: /^① 日報の製品をつなぐ/ })).toBeVisible({ timeout: 30000 })
    await screenshot(page, "hub-tablet")
    await page.goto("/master/daily-reports/customers")
    await expect(page.getByRole("region", { name: "顧客先「見本商事」" })).toBeVisible({ timeout: 30000 })
    await screenshot(page, "customers-tablet")
    await page.goto("/master/daily-reports/processes")
    await expect(page.getByTestId("process-product-row")).toHaveCount(2, { timeout: 30000 })
    await screenshot(page, "processes-tablet")
  })
})
