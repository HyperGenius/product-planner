import { test, expect, type Page } from "@playwright/test"

/**
 * 生産スケジュールのタブレットのタッチ操作（Issue #581）
 *
 * 前提:
 * - Supabase (supabase start), backend (uvicorn app.main:app --port 8000),
 *   frontend (npm run dev) がすべてローカルで起動していること
 * - E2E_USER_EMAIL / E2E_USER_PASSWORD のユーザーでログインできること
 *
 * タブレット横向き（1180×820、タッチ、ホバー無し）で動かす。スケジュール・カレンダー・進捗・自分のロール・
 * スケジュールの更新の API 応答は page.route() で固定する。顧客名・品名・注文番号はダミー値。
 *
 * スクリーンショットは test-results/gantt-tablet-touch/ に保存する（gitignore 済み）。
 */
const email = process.env.E2E_USER_EMAIL ?? "test@example.com"
const password = process.env.E2E_USER_PASSWORD ?? "Test123!"

// 2026-09-13(日)〜09-19(土) の週（ja ロケールは日曜始まり）。水曜を「今」に固定する
const NOW = new Date("2026-09-16T10:00:00+09:00")
const jst = (day: number, time: string) => `2026-09-${String(day).padStart(2, "0")}T${time}:00+09:00`

const ORDER = {
  order_id: 9301,
  equipment_id: null,
  order_number: "E2E-T1",
  customer_order_no: "PO-E2E",
  order_status: "in_progress",
  quantity: 300,
  desired_deadline: "2026-09-25",
  confirmed_deadline: "2026-09-18",
  product_name: "E2E製品T",
  customer_name: "E2E顧客T社",
  equipment_name: null,
  order_start_datetime: jst(14, "09:00"),
  order_end_datetime: jst(17, "12:00"),
}

const SCHEDULES = [
  { ...ORDER, id: 501, process_routing_id: 51, process_name: "プレス", sequence_order: 1, equipment_group_id: 1, equipment_group_name: "プレスG", start_datetime: jst(14, "09:00"), end_datetime: jst(14, "17:00"), process_start_datetime: jst(14, "09:00"), process_end_datetime: jst(15, "12:00") },
  { ...ORDER, id: 502, process_routing_id: 51, process_name: "プレス", sequence_order: 1, equipment_group_id: 1, equipment_group_name: "プレスG", start_datetime: jst(15, "09:00"), end_datetime: jst(15, "12:00"), process_start_datetime: jst(14, "09:00"), process_end_datetime: jst(15, "12:00") },
  { ...ORDER, id: 503, process_routing_id: 52, process_name: "検査", sequence_order: 2, equipment_group_id: 2, equipment_group_name: "検査機", start_datetime: jst(16, "09:00"), end_datetime: jst(17, "12:00"), process_start_datetime: jst(16, "09:00"), process_end_datetime: jst(17, "12:00") },
]

const PROGRESS = {
  computed_at: jst(16, "09:30"),
  items: [
    { order_id: 9301, process_routing_id: 51, sequence_order: 1, process_name: "プレス", good_qty: 300, order_quantity: 300, first_actual_date: "2026-09-14", last_actual_date: "2026-09-15", status: "completed", completed_by: "quantity", planned_end_datetime: jst(15, "12:00") },
    { order_id: 9301, process_routing_id: 52, sequence_order: 2, process_name: "検査", good_qty: 120, order_quantity: 300, first_actual_date: "2026-09-16", last_actual_date: "2026-09-16", status: "in_progress", completed_by: null, planned_end_datetime: jst(17, "12:00") },
  ],
}

test.use({
  timezoneId: "Asia/Tokyo",
  viewport: { width: 1180, height: 820 },
  hasTouch: true,
})

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 })
  await page.waitForLoadState("networkidle")
}

async function openSchedule(page: Page, role = "president") {
  await page.clock.setFixedTime(NOW)
  await page.route(/\/production-schedules\?/, (route) => route.fulfill({ json: SCHEDULES }))
  await page.route(/\/calendars\?/, (route) => route.fulfill({ json: [] }))
  await page.route(/\/daily-reports\/order-progress/, (route) => route.fulfill({ json: PROGRESS }))
  await page.route(/\/tenant\/members\/me$/, (route) =>
    route.fulfill({ json: { user_id: "e2e", email, full_name: "E2E", role } }),
  )
  await login(page)
  await page.goto("/schedule")
  await expect(page.getByText("E2E顧客T社").first()).toBeVisible({ timeout: 15000 })
}

async function screenshot(page: Page, name: string) {
  // 時刻を固定しているため SSR とのハイドレーション不一致が出る。開発用オーバーレイのバッジは写さない
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
  await page.screenshot({ path: `test-results/gantt-tablet-touch/${name}.png` })
}

const sheet = (page: Page) => page.getByTestId("schedule-detail-sheet")
const bar = (page: Page, id: number) => page.locator(`[data-task-id="schedule-${id}"]`)
const rowLabel = (page: Page, text: string) =>
  page.getByTestId("gantt-row-label").filter({ hasText: text })

test("タブレット幅で開くとサイドバーを閉じ、ツールバー・行のタップ目標は 44px 以上", async ({ page }) => {
  await openSchedule(page)
  await expect(page.locator('[data-slot="sidebar"][data-state]').first()).toHaveAttribute("data-state", "collapsed")
  await screenshot(page, "toolbar")

  const targets = [
    page.getByRole("button", { name: "今日" }),
    page.getByRole("button", { name: "前の期間" }),
    page.getByRole("button", { name: "次の期間" }),
    page.getByLabel("日付へ移動"),
    page.getByRole("radio", { name: "注文別" }),
    page.getByRole("radio", { name: "週" }),
    page.getByRole("combobox", { name: "設備グループ選択" }),
    page.getByRole("button", { name: "最新の情報に更新" }),
    page.getByRole("button", { name: "すべて折りたたむ" }),
  ]
  for (const target of targets) {
    expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect((await rowLabel(page, "プレス").boundingBox())!.height).toBeGreaterThanOrEqual(44)
  // バーのタップ範囲（::before）も 44px
  const hitHeight = await bar(page, 503).evaluate((el) => getComputedStyle(el, "::before").height)
  expect(parseFloat(hitHeight)).toBeGreaterThanOrEqual(44)

  await expect(page.getByText(/最終更新 \d{2}:\d{2}:\d{2}/)).toBeVisible()
})

test("工程バーをタップすると詳細シートが開き、開いている行がハイライトされる", async ({ page }) => {
  await openSchedule(page)

  await bar(page, 503).tap()
  await expect(sheet(page)).toBeVisible()
  await expect(sheet(page)).toContainText("検査")
  await expect(sheet(page)).toContainText("120 / 300（40%）")
  await expect(sheet(page)).toContainText("E2E顧客T社")
  await expect(sheet(page)).toContainText("PO-E2E")
  await expect(rowLabel(page, "検査").locator("..")).toHaveAttribute("data-selected", "true")
  await screenshot(page, "process-sheet")

  // ガントは隠れていないので、そのまま別の行（注文行）をタップして切り替えられる
  await rowLabel(page, "E2E顧客T社").getByRole("button", { name: /E2E顧客T社/ }).tap()
  await expect(sheet(page)).toHaveAttribute("aria-label", "注文の詳細")
  await expect(sheet(page)).toContainText("プレス")
  await expect(sheet(page)).toContainText("完了")
  await screenshot(page, "order-sheet")

  await page.getByRole("button", { name: "詳細を閉じる" }).tap()
  await expect(sheet(page)).toBeHidden()
})

test("スワイプでスクロールしたときは詳細シートを開かない", async ({ page }) => {
  await openSchedule(page)
  const box = (await bar(page, 501).boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // バーの上から指を置いて上へスワイプする
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - i * 8 }] })
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })

  await page.waitForTimeout(500)
  await expect(sheet(page)).toBeHidden()
})

test("編集できるロールは詳細シートの「操作」から区間の開始・終了を変更できる", async ({ page }) => {
  await openSchedule(page, "president")
  const patched: unknown[] = []
  await page.route(/\/production-schedules\/502$/, async (route) => {
    patched.push(route.request().postDataJSON())
    await route.fulfill({ json: SCHEDULES[1] })
  })

  await bar(page, 502).tap()
  const edit = sheet(page).getByRole("button", { name: /9\/15 09:00 の開始・終了を編集/ })
  await edit.tap()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("終了日時").fill("2026-09-15T14:00")
  await screenshot(page, "edit-dialog")
  await dialog.getByRole("button", { name: "保存", exact: true }).tap()
  await expect(dialog).toBeHidden()
  expect(patched).toEqual([{ start_datetime: "2026-09-15T00:00:00.000Z", end_datetime: "2026-09-15T05:00:00.000Z" }])
})

test("編集できないロールには「操作」を出さない（タップは詳細を開くだけ）", async ({ page }) => {
  await openSchedule(page, "order_handler")
  await bar(page, 502).tap()
  await expect(sheet(page)).toBeVisible()
  await expect(sheet(page).getByRole("button", { name: /開始・終了を編集/ })).toHaveCount(0)
  await expect(page.getByRole("dialog")).toHaveCount(0)
})

test("表示単位・期間の選択は開き直しても残る", async ({ page }) => {
  await openSchedule(page)
  await page.getByRole("radio", { name: "フラット" }).tap()
  await page.getByRole("radio", { name: "月" }).tap()

  await page.reload()
  await expect(page.getByText("E2E顧客T社").first()).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole("radio", { name: "フラット" })).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("radio", { name: "月" })).toHaveAttribute("aria-checked", "true")
})
