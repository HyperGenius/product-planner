import { test, expect, type Page } from "@playwright/test"

/**
 * ガントチャート週次・月次表示の工程バー（Issue #535 / #537）
 *
 * 前提:
 * - Supabase (supabase start), backend (uvicorn app.main:app --port 8000),
 *   frontend (npm run dev) がすべてローカルで起動していること
 * - E2E_USER_EMAIL / E2E_USER_PASSWORD のユーザーでログインできること
 *
 * スケジュール・カレンダー・進捗の API 応答は page.route() で固定する（バーの描画だけを見るため）。
 * セグメントの形は本番で見つかった受注を参考にしたが、受注番号・品名等はダミー値。
 *
 * スクリーンショットは test-results/gantt-segment-bars/ に保存する（gitignore 済み）。
 * 修正前後を撮り分けるときは SCREENSHOT_LABEL=before / after を付けて実行する。
 */
const email = process.env.E2E_USER_EMAIL ?? "test@example.com"
const password = process.env.E2E_USER_PASSWORD ?? "Test123!"
const screenshotLabel = process.env.SCREENSHOT_LABEL ?? "after"

// 2026-09-13(日)〜09-19(土) の週（ja ロケールは日曜始まり）。水曜を「今」に固定する
const NOW = new Date("2026-09-16T10:00:00+09:00")

const jst = (day: number, time: string) => `2026-09-${String(day).padStart(2, "0")}T${time}:00+09:00`

interface Segment {
  id: number
  routingId: number
  process: string
  start: string
  end: string
}

function order(orderId: number, label: string, segments: Segment[]) {
  return segments.map((s) => ({
    id: s.id,
    order_id: orderId,
    process_routing_id: s.routingId,
    equipment_id: null,
    start_datetime: s.start,
    end_datetime: s.end,
    order_number: `E2E-${label}`,
    product_name: `E2E製品${label}`,
    customer_name: "E2E顧客",
    process_name: s.process,
    equipment_group_name: `${s.process}G`,
  }))
}

const SCHEDULES = [
  // 本番で見つかった形: 1工程（内職）が毎日 09:00〜17:00 で続き、木曜の朝に終わる
  ...order(9001, "A", [
    { id: 101, routingId: 11, process: "内職", start: jst(14, "09:00"), end: jst(14, "17:00") },
    { id: 102, routingId: 11, process: "内職", start: jst(15, "09:00"), end: jst(15, "17:00") },
    { id: 103, routingId: 11, process: "内職", start: jst(16, "09:00"), end: jst(16, "17:00") },
    { id: 104, routingId: 11, process: "内職", start: jst(17, "09:00"), end: jst(17, "09:10") },
    { id: 105, routingId: 12, process: "組立", start: jst(17, "09:10"), end: jst(17, "13:30") },
    { id: 106, routingId: 13, process: "洗浄", start: jst(17, "13:30"), end: jst(17, "16:50") },
    { id: 107, routingId: 14, process: "検査", start: jst(18, "09:00"), end: jst(18, "17:00") },
  ]),
  // ケース1: 1工程のセグメントが飛び飛び（月曜と木曜の午後）
  ...order(9002, "B", [
    { id: 201, routingId: 21, process: "内職", start: jst(14, "09:00"), end: jst(14, "17:00") },
    { id: 202, routingId: 21, process: "内職", start: jst(17, "13:30"), end: jst(17, "17:00") },
  ]),
  // ケース2: 同じ工程名の工程がルーティングに2回ある（間に別工程を挟む）
  ...order(9003, "C", [
    { id: 301, routingId: 31, process: "内職", start: jst(14, "09:00"), end: jst(14, "12:00") },
    { id: 302, routingId: 32, process: "組立", start: jst(14, "13:00"), end: jst(14, "17:00") },
    { id: 303, routingId: 33, process: "内職", start: jst(16, "09:00"), end: jst(16, "12:00") },
  ]),
  // ケース3: 終了時刻がスロットの開始ちょうど
  ...order(9004, "D", [
    { id: 401, routingId: 41, process: "プレス", start: jst(15, "09:00"), end: jst(15, "10:00") },
    { id: 402, routingId: 42, process: "検査", start: jst(15, "10:00"), end: jst(15, "11:00") },
  ]),
]

test.use({ timezoneId: "Asia/Tokyo", viewport: { width: 1600, height: 1400 } })

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 })
  await page.waitForLoadState("networkidle")
}

async function mockScheduleApis(page: Page) {
  await page.route(/\/production-schedules\?/, (route) => route.fulfill({ json: SCHEDULES }))
  // 祝日なし（土日はページ側で非稼働日にする）
  await page.route(/\/calendars\?/, (route) => route.fulfill({ json: [] }))
  await page.route(/\/daily-reports\/order-progress/, (route) =>
    route.fulfill({ json: { computed_at: null, items: [] } }),
  )
}

/** ツールバーのセグメントボタン（表示単位・期間。Issue #581 で Select から変更）を選ぶ */
async function selectOption(page: Page, groupLabel: string, option: string) {
  const radio = page.getByRole("radiogroup", { name: groupLabel }).getByRole("radio", { name: option, exact: true })
  await radio.click()
  await expect(radio).toHaveAttribute("aria-checked", "true")
}

async function openSchedule(page: Page) {
  await page.clock.setFixedTime(NOW)
  await mockScheduleApis(page)
  await login(page)
  await page.goto("/schedule")
  await expect(page.getByText("E2E製品A").first()).toBeVisible({ timeout: 15000 })
}

async function screenshot(page: Page, name: string) {
  // 時刻を固定しているため SSR とのハイドレーション不一致が出る。開発用オーバーレイのバッジは写さない
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
  await page.screenshot({
    path: `test-results/gantt-segment-bars/${screenshotLabel}-${name}.png`,
    fullPage: true,
  })
}

function bar(page: Page, scheduleId: number) {
  return page.locator(`[data-task-id="schedule-${scheduleId}"]`)
}

async function gridColumn(page: Page, scheduleId: number) {
  return bar(page, scheduleId).evaluate((el) => (el as HTMLElement).style.gridColumn)
}

/**
 * そのバーが描かれている行の位置。行は「ラベルセル＋タイムラインのグリッド」なので（Issue #578）、
 * グリッドの親（行）が行の並びの何番目かを返す
 */
async function rowOf(page: Page, scheduleId: number) {
  return bar(page, scheduleId).evaluate((el) => {
    const row = el.closest('[style*="grid-template-columns"]')?.parentElement
    return Array.from(row?.parentElement?.children ?? []).indexOf(row as Element)
  })
}

test.describe("ガントチャート週次表示の工程バー（Issue #535）", () => {
  test("オーダー別: セグメントごとにバーを描き、同じ工程は1行に並べる", async ({ page }) => {
    await openSchedule(page)
    await screenshot(page, "week-order")

    // 1日7スロット（9〜17時、12時台は休憩）。月曜が1〜7列、木曜が22〜28列
    // ケース1: 月曜 09:00〜17:00 と木曜 13:30〜17:00 は別のバー。間（火・水）を塗らない
    expect(await gridColumn(page, 201)).toBe("1 / 8")
    expect(await gridColumn(page, 202)).toBe("26 / 29")
    expect(await rowOf(page, 201)).toBe(await rowOf(page, 202))

    // ケース2: 同じ工程名でも別の工程（ルーティング）は別の行
    expect(await rowOf(page, 301)).not.toBe(await rowOf(page, 303))

    // ケース3: 10:00 ちょうどに終わる工程は 09:00 の1列だけ（次の工程の列に重ならない）
    expect(await gridColumn(page, 401)).toBe("8 / 9")
    expect(await gridColumn(page, 402)).toBe("9 / 10")

    // 本番で見つかった形: 内職の最終日（木曜 09:00〜09:10）は木曜の 09:00 の1列
    expect(await gridColumn(page, 104)).toBe("22 / 23")
  })

  test("ツールチップ: セグメントの日付と工程全体の範囲を出す", async ({ page }) => {
    await openSchedule(page)

    await bar(page, 102).hover()
    const tooltip = page.getByRole("tooltip")
    await expect(tooltip).toContainText("9/15 09:00 - 17:00")
    await expect(tooltip).toContainText("この工程（表示中）: 9/14 09:00 - 9/17 09:10（4区間）")
    await screenshot(page, "week-tooltip")
  })

  test("フラット表示でも同じ工程のセグメントを1行に並べる", async ({ page }) => {
    await openSchedule(page)
    await selectOption(page, "表示単位", "フラット")
    await screenshot(page, "week-flat")

    expect(await rowOf(page, 201)).toBe(await rowOf(page, 202))
    expect(await rowOf(page, 301)).not.toBe(await rowOf(page, 303))
  })

  test("日次表示（比較用）はセグメントごとに行を分ける", async ({ page }) => {
    await openSchedule(page)
    await selectOption(page, "期間", "日")
    await screenshot(page, "day-order")

    expect(await rowOf(page, 102)).not.toBe(await rowOf(page, 103))
  })
})

test.describe("ガントチャート月次表示の工程バー（Issue #537）", () => {
  // 月次の表示範囲は基準日（9/16）の前3日〜後31日。9/13(日) が1列目なので、9/N の列は N-12
  async function openMonth(page: Page) {
    await openSchedule(page)
    await selectOption(page, "期間", "月")
    await expect(bar(page, 101)).toBeVisible()
  }

  test("オーダー別: バーはその日の列に描かれ、同じ工程は1行に並ぶ", async ({ page }) => {
    await openMonth(page)
    await screenshot(page, "month-order")

    // 月〜木の内職（09:00〜17:00）はそれぞれの日の列。翌日の列にずれない
    expect(await gridColumn(page, 101)).toBe("2 / 3")
    expect(await gridColumn(page, 102)).toBe("3 / 4")
    expect(await gridColumn(page, 103)).toBe("4 / 5")
    expect(await gridColumn(page, 104)).toBe("5 / 6")
    // 金曜の検査は金曜の列（土曜の列ではない）
    expect(await gridColumn(page, 107)).toBe("6 / 7")

    // 内職の4セグメントは1行。同じ工程名でも別の工程（ルーティング）は別の行
    const row = await rowOf(page, 101)
    for (const id of [102, 103, 104]) expect(await rowOf(page, id)).toBe(row)
    expect(await rowOf(page, 301)).not.toBe(await rowOf(page, 303))

    // ケース1: 月曜と木曜の飛び飛びのセグメント。間（火・水）を塗らない
    expect(await gridColumn(page, 201)).toBe("2 / 3")
    expect(await gridColumn(page, 202)).toBe("5 / 6")
    expect(await rowOf(page, 201)).toBe(await rowOf(page, 202))
  })

  test("フラット表示でも同じ工程のセグメントを1行に並べる", async ({ page }) => {
    await openMonth(page)
    await selectOption(page, "表示単位", "フラット")
    await screenshot(page, "month-flat")

    expect(await rowOf(page, 201)).toBe(await rowOf(page, 202))
    expect(await rowOf(page, 301)).not.toBe(await rowOf(page, 303))
  })

  test("ツールチップ: セグメントの日付と工程全体の範囲を出す", async ({ page }) => {
    await openMonth(page)

    await bar(page, 102).hover()
    const tooltip = page.getByRole("tooltip")
    await expect(tooltip).toContainText("9/15 09:00 - 17:00")
    await expect(tooltip).toContainText("この工程（表示中）: 9/14 09:00 - 9/17 09:10（4区間）")
    await screenshot(page, "month-tooltip")
  })
})
