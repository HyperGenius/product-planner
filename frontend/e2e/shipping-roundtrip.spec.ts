import { test, expect, type Page, type Route } from "@playwright/test"

/**
 * 送品の消し込みと弥生の名寄せ・受注作成の行き帰り（Issue #694）の見た目を撮る。
 *
 * 前提:
 * - Supabase (supabase start) と frontend (npm run dev) がローカルで起動していること
 * - E2E_USER_EMAIL / E2E_USER_PASSWORD のユーザーでログインできること
 *
 * バックエンドの API（localhost:8000）はすべて page.route() で固定応答にするので、backend は起動しなくてよい。
 * 受注の作成・得意先のひも付けを受けたら、弥生の明細の応答から該当のまとまりを消す（突合が変わったことを再現する）。
 * 注文番号・顧客名・品名・得意先はダミー値。
 *
 * スクリーンショットは test-results/shipping-roundtrip/ に保存する（gitignore 済み）。
 */
const email = process.env.E2E_USER_EMAIL ?? "test@example.com"
const password = process.env.E2E_USER_PASSWORD ?? "Test123!"

const NOW = new Date("2026-11-25T10:00:00+09:00")
test.use({ timezoneId: "Asia/Tokyo" })

const CUSTOMERS = [
  { id: 1, name: "株式会社サンプル工業", alias: "サンプル", status: "active" },
  { id: 2, name: "テスト精機株式会社", alias: "テスト精機", status: "active" },
]
const PRODUCTS = [
  { id: 101, name: "ブラケットA", code: "DW-101", is_active: true, has_process: true },
  { id: 102, name: "シャフトB", code: "DW-102", is_active: true, has_process: true },
  { id: 103, name: "カバーC", code: "DW-103", is_active: true, has_process: true },
]

function order(id: number, fields: { product: number; customer: number; qty: number; deadline: string }) {
  return {
    id,
    order_no: `S-${String(id).padStart(4, "0")}`,
    product_id: fields.product,
    customer_id: fields.customer,
    quantity: fields.qty,
    desired_deadline: fields.deadline,
    confirmed_deadline: fields.deadline,
    status: "confirmed",
    customer_certainty: "confirmed",
    is_scheduled: true,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
  }
}

const ORDERS = [
  order(1, { product: 101, customer: 1, qty: 200, deadline: "2026-11-28" }),
  order(2, { product: 102, customer: 2, qty: 50, deadline: "2026-12-10" }),
  order(4, { product: 101, customer: 1, qty: 300, deadline: "2026-11-18" }),
]

const MATCHES = [
  {
    order_id: 1,
    shipped_qty: 200,
    order_quantity: 200,
    is_fully_shipped: true,
    last_sales_date: "2026-11-21",
    entries: [
      { id: 10, sales_date: "2026-11-21", slip_no: "1010", quantity: 200, note: null, product_name: "ブラケットA", method: "deadline", candidate_order_ids: [] },
    ],
    ambiguous_entries: [],
  },
]

const PROGRESS = [1, 2, 4].map((orderId) => ({
  order_id: orderId,
  process_routing_id: 1,
  sequence_order: 1,
  process_name: "プレス",
  good_qty: orderId === 1 ? 200 : 10,
  order_quantity: 100,
  first_actual_date: "2026-11-10",
  last_actual_date: "2026-11-20",
  status: orderId === 1 ? "completed" : "in_progress",
  completed_by: orderId === 1 ? "quantity" : null,
  planned_end_datetime: null,
}))

function group(status: string, fields: Record<string, unknown>) {
  return {
    status,
    customer_code: "001",
    customer_code_key: "001",
    customer_name: "株式会社サンプル工業",
    product_code: "A-01",
    product_code_key: "A-01",
    product_name: "ブラケットA",
    latest_note: null,
    entry_count: 1,
    total_qty: 100,
    last_sales_date: "2026-11-20",
    customer_ids: [],
    product_ids: [],
    note_deadlines: [],
    candidate_order_ids: [],
    ...fields,
  }
}

const UNMATCHED_CUSTOMER = group("unmatched_customer", {
  customer_code: "090",
  customer_code_key: "090",
  customer_name: "見本商事(株)",
  product_code: "Z-1",
  product_code_key: "Z-1",
})
const REGISTER_SHAFT = group("no_order", {
  customer_code: "002",
  customer_code_key: "002",
  customer_name: "テスト精機(株)",
  product_code: "B-02",
  product_code_key: "B-02",
  product_name: "シャフトB",
  customer_ids: [2],
  product_ids: [102],
  note_deadlines: ["2026-11-30"],
  entry_count: 2,
  total_qty: 160,
})
const REGISTER_COVER = group("no_order", {
  product_code: "C-03",
  product_code_key: "C-03",
  product_name: "カバーC",
  customer_ids: [1],
  product_ids: [103],
  latest_note: "12/5納期分",
  entry_count: 1,
  total_qty: 40,
})

function customerItem(fields: Record<string, unknown>) {
  return {
    customer_code: "001",
    code_key: "001",
    customer_name: "株式会社サンプル工業",
    entry_count: 12,
    last_sales_date: "2026-11-20",
    links: [],
    auto_customer_id: null,
    ignored_id: null,
    name_candidate_ids: [],
    flow_candidates: [],
    unmatched_entry_count: 0,
    ...fields,
  }
}

/** 操作の結果で応答を変える API の状態 */
interface ApiState {
  createdOrder: boolean
  linkedCustomer: boolean
}

function unmatchedEntries(state: ApiState) {
  const items = [
    ...(state.linkedCustomer ? [] : [UNMATCHED_CUSTOMER]),
    ...(state.createdOrder ? [] : [REGISTER_SHAFT]),
    REGISTER_COVER,
  ]
  const counts = { unmatched_customer: 0, unmatched_product: 0, no_order: 0, ambiguous: 0 }
  for (const item of items) counts[item.status as keyof typeof counts] += 1
  return { latest_sales_date: "2026-11-21", since: "2026-09-23", counts, truncated: false, items }
}

function shipmentCustomers(state: ApiState) {
  return [
    // 直近60日に売上がある未登録の得意先（ハブの前提バナーに出る）
    customerItem({
      customer_code: "090",
      code_key: "090",
      customer_name: "見本商事(株)",
      entry_count: 3,
      last_sales_date: "2026-11-20",
      links: state.linkedCustomer ? [{ id: "l-1", customer_id: 1 }] : [],
      flow_candidates: [{ customer_id: 1, entry_count: 3 }],
      unmatched_entry_count: 3,
    }),
    // 直近60日より前の売上しかない未登録の得意先（全期間にだけ出る）
    customerItem({
      customer_code: "077",
      code_key: "077",
      customer_name: "旧取引(有)",
      entry_count: 5,
      last_sales_date: "2026-06-30",
    }),
    customerItem({ links: [{ id: "l-0", customer_id: 1 }] }),
    customerItem({
      customer_code: "002",
      code_key: "002",
      customer_name: "テスト精機(株)",
      auto_customer_id: 2,
      last_sales_date: "2026-11-18",
    }),
  ]
}

/** localhost:8000 の API をすべて固定応答にする（知らないパスは空の一覧） */
async function mockApi(page: Page, state: ApiState) {
  await page.route(/^http:\/\/localhost:8000\//, async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const json = (body: unknown, status = 200) => route.fulfill({ json: body, status })
    if (path === "/tenant/members/me")
      return json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role: "president" })
    if (path === "/orders/simulate" && method === "POST")
      return json({ routing_status: "no_routing", calculated_deadline: null, is_feasible: null, process_schedules: [] })
    if (path === "/orders" && method === "POST") {
      state.createdOrder = true
      return json({ ...order(99, { product: 102, customer: 2, qty: 160, deadline: "2026-11-30" }), status: "draft" }, 201)
    }
    if (path === "/orders") return json(ORDERS)
    if (path === "/customers") return json(CUSTOMERS)
    if (path === "/products") return json(PRODUCTS)
    if (path === "/daily-reports/order-progress") {
      const ids = url.searchParams.getAll("order_id").map(Number)
      return json({ computed_at: "2026-11-25T00:15:00Z", items: PROGRESS.filter((p) => ids.includes(p.order_id)) })
    }
    if (path === "/shipments/order-matches") {
      const ids = url.searchParams.getAll("order_id").map(Number)
      return json({ latest_sales_date: "2026-11-21", items: MATCHES.filter((m) => ids.includes(m.order_id)) })
    }
    if (path === "/shipments/unmatched-entries") return json(unmatchedEntries(state))
    if (path === "/shipments/order-reviews")
      return json({
        computed_at: "2026-11-25T00:15:00Z",
        counts: { no_routing: 0, process_mismatch: 0, customer_or_stock: 0, missing_report: 0 },
        items: [],
      })
    if (path === "/shipments/customer-links" && method === "POST") {
      state.linkedCustomer = true
      return json({ id: "l-1" }, 201)
    }
    if (path === "/shipments/customers") return json(shipmentCustomers(state))
    if (path === "/shipments/products") return json([])
    if (path === "/shipment-files") return json({ last_received_at: "2026-11-22T00:30:00Z", files: [] })
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
  await page.screenshot({ path: `test-results/shipping-roundtrip/${name}.png` })
}

async function open(page: Page, path: string): Promise<ApiState> {
  const state: ApiState = { createdOrder: false, linkedCustomer: false }
  await page.clock.setFixedTime(NOW)
  await mockApi(page, state)
  await login(page)
  await page.goto(path)
  return state
}

const countChanges = (page: Page) => page.getByRole("region", { name: "前回からの件数の変化" })

test.describe("送品の消し込みと名寄せ・受注作成の行き帰り（Issue #694）", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
  })

  test("前提バナー → 弥生の名寄せ → ハブ（前回からの件数の変化）", async ({ page }) => {
    await open(page, "/orders/shipping")
    const banner = page.getByRole("region", { name: "先に片付けること" })
    await expect(banner).toContainText("弥生の得意先1件がアプリに未登録です", { timeout: 30000 })
    await expect(page.getByRole("link", { name: "③ 受注を起票する 2商品" })).toBeVisible()
    // 初めて開いたときは件数の変化を出さない
    await expect(countChanges(page)).toHaveCount(0)

    await banner.getByRole("link", { name: "名寄せする" }).click()
    await expect(page).toHaveURL(/\/orders\/shipment-names\?from=shipping#customers$/)
    await expect(page.getByRole("link", { name: "送品の消し込みに戻る" })).toBeVisible()
    // 直近60日で開き、ハブと同じ1件だけが出る（全期間の古い得意先は出さない）
    await expect(page.getByRole("tab", { name: "直近60日" })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByRole("tab", { name: "得意先（未照合 1）" })).toBeVisible({ timeout: 30000 })
    await expect(page.getByText("見本商事(株)")).toBeVisible()
    await expect(page.getByText("旧取引(有)")).toHaveCount(0)
    await screenshot(page, "names-from-shipping-1920")

    await page.getByRole("tab", { name: "全期間" }).click()
    await expect(page.getByText("旧取引(有)")).toBeVisible()
    await expect(page.getByRole("tab", { name: "得意先（未照合 2）" })).toBeVisible()
    await screenshot(page, "names-all-period-1920")

    // 商流の推定の候補を押してひも付ける
    await page.getByRole("tab", { name: "直近60日" }).click()
    await page.getByRole("button", { name: /商流の推定・3行/ }).click()
    await expect(page.getByRole("tab", { name: "得意先（未照合 0）" })).toBeVisible()

    await page.getByRole("link", { name: "送品の消し込みに戻る" }).click()
    await expect(page).toHaveURL(/\/orders\/shipping$/)
    await expect(countChanges(page)).toContainText("未登録の得意先 1得意先 → 0得意先", { timeout: 30000 })
    await expect(page.getByRole("region", { name: "先に片付けること" })).toHaveCount(0)
    await screenshot(page, "hub-after-names-1920")
  })

  test("③ → 受注作成（初期値あり）→ ③ → ハブ（前回からの件数の変化）", async ({ page }) => {
    await open(page, "/orders/shipping")
    await page.getByRole("link", { name: "③ 受注を起票する 2商品" }).click({ timeout: 30000 })
    await expect(page).toHaveURL(/\/orders\/shipping\/register$/)
    const rows = page.getByTestId("unmatched-shipment-row")
    await expect(rows).toHaveCount(2, { timeout: 30000 })

    await rows.filter({ hasText: "B-02" }).getByRole("link", { name: "受注を起票する" }).click()
    await expect(page).toHaveURL(/\/orders\/new\?/)
    await expect(page.getByRole("link", { name: "③ 受注を起票する" })).toBeVisible()
    await expect(page.getByLabel("数量 *")).toHaveValue("160")
    await expect(page.getByLabel("希望納期（任意）")).toHaveValue("2026-11-30")
    await expect(page.getByRole("combobox", { name: "製品 *" })).toContainText("DW-102 - シャフトB", { timeout: 30000 })
    await expect(page.getByRole("combobox", { name: "顧客" })).toContainText("テスト精機")
    await screenshot(page, "new-order-prefilled-1920")

    await page.getByRole("button", { name: /シミュレーション実行/ }).click()
    await page.getByRole("button", { name: /下書きで保存する/ }).click()
    // 作成したら③へ戻り、作成した明細は③から消えている
    await expect(page).toHaveURL(/\/orders\/shipping\/register$/, { timeout: 30000 })
    await expect(rows).toHaveCount(1)
    await expect(page.getByRole("heading", { level: 1 })).toContainText("1商品")
    await screenshot(page, "register-after-create-1920")

    await page.getByRole("link", { name: "送品の消し込み", exact: true }).click()
    await expect(page).toHaveURL(/\/orders\/shipping$/)
    await expect(countChanges(page)).toContainText("③ 受注を起票する 2商品 → 1商品", { timeout: 30000 })
    await screenshot(page, "hub-after-register-1920")
  })

  test("不正なクエリで開いた受注作成は空欄のまま（戻るリンクも出さない）", async ({ page }) => {
    await open(page, "/orders/new?customer_id=abc&quantity=-3&desired_deadline=2026-02-30&return_to=https://example.com/")
    await expect(page.getByLabel("数量 *")).toHaveValue("", { timeout: 30000 })
    await expect(page.getByLabel("希望納期（任意）")).toHaveValue("")
    await expect(page.getByRole("link", { name: "③ 受注を起票する" })).toHaveCount(0)
  })

  test("弥生の名寄せをタブレット横向き（1180×820）で", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await open(page, "/orders/shipment-names?from=shipping#customers")
    await expect(page.getByRole("tab", { name: "得意先（未照合 1）" })).toBeVisible({ timeout: 30000 })
    await screenshot(page, "names-from-shipping-tablet")
  })
})
