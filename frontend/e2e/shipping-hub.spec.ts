import { test, expect, type Page, type Route } from "@playwright/test"

/**
 * 送品の消し込みのハブ（Issue #692）の見た目を撮る。
 *
 * 前提:
 * - Supabase (supabase start) と frontend (npm run dev) がローカルで起動していること
 * - E2E_USER_EMAIL / E2E_USER_PASSWORD のユーザーでログインできること
 *
 * バックエンドの API（`NEXT_PUBLIC_API_URL` の localhost:8000）はすべて page.route() で固定応答にするので、
 * backend は起動しなくてよい。注文番号・顧客名・品名・得意先はダミー値。
 *
 * スクリーンショットは test-results/shipping-hub/ に保存する（gitignore 済み）。
 * 1920×1080 とタブレット横向き（1180×820）で撮る。
 */
const email = process.env.E2E_USER_EMAIL ?? "test@example.com"
const password = process.env.E2E_USER_PASSWORD ?? "Test123!"

// 「今日」（JST）を固定し、納期超過・納期まで7日未満の判定を毎回同じにする
const NOW = new Date("2026-11-25T10:00:00+09:00")
test.use({ timezoneId: "Asia/Tokyo" })

const CUSTOMERS = [
  { id: 1, name: "株式会社サンプル工業", alias: "サンプル" },
  { id: 2, name: "テスト精機株式会社", alias: "テスト精機" },
]
const PRODUCTS = [
  { id: 101, name: "ブラケットA", code: "DW-101" },
  { id: 102, name: "シャフトB", code: "DW-102" },
  { id: 103, name: "カバーC", code: "DW-103" },
]

function order(id: number, fields: { product: number; customer: number; qty: number; deadline: string; status?: string }) {
  return {
    id,
    order_no: `S-${String(id).padStart(4, "0")}`,
    product_id: fields.product,
    customer_id: fields.customer,
    quantity: fields.qty,
    desired_deadline: fields.deadline,
    confirmed_deadline: fields.deadline,
    status: fields.status ?? "confirmed",
    customer_certainty: "confirmed",
    is_scheduled: true,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
  }
}

const ORDERS = [
  // ① 弥生で受注数量に達した
  order(1, { product: 101, customer: 1, qty: 200, deadline: "2026-11-28" }),
  order(2, { product: 102, customer: 2, qty: 50, deadline: "2026-12-10" }),
  order(3, { product: 103, customer: 1, qty: 120, deadline: "2026-11-20", status: "in_progress" }),
  // ② 最終工程完了・納期超過・納期間近
  order(4, { product: 101, customer: 1, qty: 300, deadline: "2026-11-18" }),
  order(5, { product: 102, customer: 2, qty: 80, deadline: "2026-11-29" }),
  order(6, { product: 103, customer: 2, qty: 60, deadline: "2026-12-20", status: "in_progress" }),
  // 対象外（納期が先で、最終工程も未完了）
  order(7, { product: 101, customer: 2, qty: 40, deadline: "2027-01-15" }),
]

function entry(id: number, quantity: number, candidates: number[] = []) {
  return {
    id,
    sales_date: "2026-11-21",
    slip_no: String(1000 + id),
    quantity,
    note: null,
    product_name: "ブラケットA",
    method: candidates.length ? null : "deadline",
    candidate_order_ids: candidates,
  }
}

function match(orderId: number, shipped: number, qty: number, ambiguous: number[] = []) {
  return {
    order_id: orderId,
    shipped_qty: shipped,
    order_quantity: qty,
    is_fully_shipped: shipped >= qty,
    last_sales_date: "2026-11-21",
    entries: [entry(orderId * 10, shipped)],
    ambiguous_entries: ambiguous.length ? [entry(orderId * 10 + 1, 20, ambiguous)] : [],
  }
}

const MATCHES = [match(1, 200, 200), match(2, 50, 50), match(3, 120, 120), match(4, 150, 300, [4, 7])]

function progressRow(orderId: number, status: string, good: number, qty: number) {
  return {
    order_id: orderId,
    process_routing_id: 1,
    sequence_order: 1,
    process_name: "プレス",
    good_qty: good,
    order_quantity: qty,
    first_actual_date: "2026-11-10",
    last_actual_date: "2026-11-20",
    status,
    completed_by: status === "completed" ? "quantity" : null,
    planned_end_datetime: null,
  }
}

const PROGRESS = [
  progressRow(1, "completed", 200, 200),
  progressRow(2, "in_progress", 20, 50),
  progressRow(3, "completed", 120, 120),
  progressRow(4, "in_progress", 150, 300),
  progressRow(5, "in_progress", 40, 80),
  progressRow(6, "completed", 60, 60),
  progressRow(7, "not_started", 0, 40),
]

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

const UNMATCHED_ITEMS = [
  group("unmatched_customer", { customer_code: "090", customer_code_key: "090", customer_name: "見本商事(株)", product_code: "Z-1", product_code_key: "Z-1" }),
  group("unmatched_product", { product_code: "P-77", product_code_key: "P-77", product_name: "ブラケットA 改", customer_ids: [1] }),
  group("unmatched_product", { product_code: "SORYO", product_code_key: "SORYO", product_name: "運賃", customer_ids: [1] }),
  group("no_order", { product_code: "B-02", product_code_key: "B-02", product_name: "シャフトB", customer_ids: [2], product_ids: [102], note_deadlines: ["2026-11-30"], entry_count: 2, total_qty: 160 }),
  group("no_order", { product_code: "C-03", product_code_key: "C-03", product_name: "カバーC", customer_ids: [1], product_ids: [103], latest_note: "12/5納期分", entry_count: 1, total_qty: 40 }),
  group("ambiguous", { product_code: "A-01", product_code_key: "A-01", customer_ids: [1], product_ids: [101], candidate_order_ids: [4, 7] }),
]

const UNMATCHED = {
  latest_sales_date: "2026-11-21",
  since: "2026-09-23",
  counts: { unmatched_customer: 1, unmatched_product: 2, no_order: 2, ambiguous: 1 },
  truncated: false,
  items: UNMATCHED_ITEMS,
}

const REVIEWS = {
  computed_at: "2026-11-25T00:15:00Z",
  counts: { no_routing: 0, process_mismatch: 1, customer_or_stock: 0, missing_report: 1 },
  items: [
    { order_id: 2, product_id: 102, cause: "missing_report", shipped_qty: 50, last_sales_date: "2026-11-21", final_process_name: "プレス", final_good_qty: 20, unallocated_qty: 0, process_names: [] },
    { order_id: 4, product_id: 101, cause: "process_mismatch", shipped_qty: 150, last_sales_date: "2026-11-21", final_process_name: "プレス", final_good_qty: 150, unallocated_qty: 30, process_names: ["ﾌﾟﾚｽ加工"] },
  ],
}

/** localhost:8000 の API をすべて固定応答にする（知らないパスは空の一覧） */
async function mockApi(page: Page) {
  await page.route(/^http:\/\/localhost:8000\//, (route: Route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const json = (body: unknown) => route.fulfill({ json: body })
    if (path === "/tenant/members/me")
      return json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role: "president" })
    if (path === "/orders") return json(ORDERS)
    if (path === "/customers") return json(CUSTOMERS)
    if (path === "/products") return json(PRODUCTS)
    if (path === "/daily-reports/order-progress") {
      const ids = url.searchParams.getAll("order_id").map(Number)
      return json({ computed_at: REVIEWS.computed_at, items: PROGRESS.filter((p) => ids.includes(p.order_id)) })
    }
    if (path === "/shipments/order-matches") {
      const ids = url.searchParams.getAll("order_id").map(Number)
      return json({ latest_sales_date: "2026-11-21", items: MATCHES.filter((m) => ids.includes(m.order_id)) })
    }
    if (path === "/shipments/unmatched-entries") return json(UNMATCHED)
    if (path === "/shipments/order-reviews") return json(REVIEWS)
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
  await page.screenshot({ path: `test-results/shipping-hub/${name}.png` })
}

async function openHub(page: Page, hash = "") {
  await page.clock.setFixedTime(NOW)
  await mockApi(page)
  await login(page)
  await page.goto(`/orders/shipping${hash}`)
  await expect(page.getByRole("button", { name: "① 送品済みにする 3注文" })).toBeVisible({ timeout: 30000 })
}

test.describe("送品の消し込みのハブ（Issue #692）", () => {
  test("1920×1080: ①の一覧と前提バナー", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHub(page)

    await expect(page.getByRole("region", { name: "先に片付けること" })).toContainText(
      "弥生の得意先1件・商品2件がアプリに未登録です",
    )
    await expect(page.getByRole("button", { name: "② 出荷を確かめる 3注文" })).toBeVisible()
    await expect(page.getByRole("button", { name: "③ 受注を起票する 2商品" })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "日報が未入力の出荷済み注文 2注文" }),
    ).toBeVisible()
    await expect(page.getByRole("region", { name: "① 送品済みにする" }).getByRole("row")).toHaveCount(4)
    // サイドバーのバッジは①の件数だけ（#692）
    await expect(page.getByRole("link", { name: /送品の消し込み/ })).toContainText("3")
    await screenshot(page, "hub-ship-1920")
  })

  test("1920×1080: ②出荷を確かめる", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHub(page, "#confirm")
    await expect(page.getByRole("region", { name: "② 出荷を確かめる" }).getByRole("row")).toHaveCount(4)
    await screenshot(page, "hub-confirm-1920")
  })

  test("1920×1080: ③受注を起票する", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHub(page, "#register")
    await expect(page.getByTestId("unmatched-shipment-row")).toHaveCount(2)
    await screenshot(page, "hub-register-1920")
  })

  test("1920×1080: 送り先の受注を確かめる", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHub(page)
    await page.getByRole("button", { name: "受注を確かめる" }).click()
    await expect(page.getByRole("region", { name: "送り先の受注を確かめる" })).toBeVisible()
    await expect(page.getByTestId("unmatched-shipment-row")).toHaveCount(1)
    await screenshot(page, "hub-ambiguous-1920")
  })

  test("1920×1080: 日報が未入力の出荷済み注文", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHub(page, "#daily-reports")
    await expect(page.getByTestId("order-review-product-row")).toHaveCount(2)
    await screenshot(page, "hub-daily-reports-1920")
  })

  test("1920×1080: ヘルプ", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await openHub(page)
    await page.getByRole("button", { name: "ヘルプを開く" }).click()
    await expect(page.getByRole("dialog")).toContainText("② 出荷を確かめる")
    // 開くアニメーションの途中を撮らない
    await page.waitForTimeout(500)
    await screenshot(page, "hub-help-1920")
  })

  test("#review で開いてもハブを出す（タブレット横向き 1180×820）", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 })
    await openHub(page, "#review")
    await expect(page.getByRole("region", { name: "① 送品済みにする" })).toBeVisible()
    await screenshot(page, "hub-ship-tablet")
  })
})
