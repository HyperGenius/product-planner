import { test, expect, type Page } from "@playwright/test"

/**
 * ガントの注文行・工程行のラベルと、注文行のサマリーバー・折りたたみ（Issue #579）、
 * ラベルの絞り込み（顧客の通称・製品名・数量だけ）と凡例の開閉（Issue #589）
 *
 * 前提:
 * - Supabase (supabase start), backend (uvicorn app.main:app --port 8000),
 *   frontend (npm run dev) がすべてローカルで起動していること
 * - E2E_USER_EMAIL / E2E_USER_PASSWORD のユーザーでログインできること
 *
 * スケジュール・カレンダー・進捗の API 応答は page.route() で固定する（描画だけを見るため）。
 * 顧客名・品名・注文番号はダミー値。
 *
 * スクリーンショットは test-results/gantt-order-labels/ に保存する（gitignore 済み）。
 * タブレット横向き（1180×820）と 1920×1080 の両方で撮る。
 */
const email = process.env.E2E_USER_EMAIL ?? "test@example.com"
const password = process.env.E2E_USER_PASSWORD ?? "Test123!"

/** 顧客の通称（ダミー）。推奨の上限の全角6文字（Issue #589）で、ラベル列で省略されないことを確かめる */
const ALIAS = "顧客甲乙丙社"
/** 正式名称（ダミー）。ラベル列には出さず、詳細シートで通称と併記する */
const CUSTOMER_FULL_NAME = "株式会社顧客甲乙丙社製作所"

// 2026-09-13(日)〜09-19(土) の週（ja ロケールは日曜始まり）。水曜を「今」に固定する
const NOW = new Date("2026-09-16T10:00:00+09:00")

const jst = (month: number, day: number, time: string) =>
  `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${time}:00+09:00`

interface Segment {
  id: number
  routingId: number
  seq: number
  process: string
  group: string
  start: string
  end: string
}

interface OrderFields {
  orderId: number
  orderNumber: string | null
  customer: string | null
  alias?: string | null
  product: string
  quantity: number
  desired: string | null
  confirmed: string | null
  /** 表示期間外を含む受注全体の開始〜終了（省略時は表示中のセグメントから求める） */
  extent?: [string, string]
  /** 表示期間外を含む工程ごとの開始〜終了 */
  processExtents?: Record<number, [string, string]>
}

const GROUP_IDS: Record<string, number> = {
  カシメ機: 1,
  ワシノ25t: 2,
  検査機: 3,
  内職: 4,
  組立G: 5,
}

function order(fields: OrderFields, segments: Segment[]) {
  const starts = segments.map((s) => s.start).sort()
  const ends = segments.map((s) => s.end).sort()
  const [orderStart, orderEnd] = fields.extent ?? [starts[0], ends[ends.length - 1]]
  return segments.map((s) => {
    const own = segments.filter((x) => x.routingId === s.routingId)
    const [processStart, processEnd] = fields.processExtents?.[s.routingId] ?? [
      own.map((x) => x.start).sort()[0],
      own.map((x) => x.end).sort()[own.length - 1],
    ]
    return {
      id: s.id,
      order_id: fields.orderId,
      process_routing_id: s.routingId,
      equipment_id: null,
      start_datetime: s.start,
      end_datetime: s.end,
      order_number: fields.orderNumber,
      customer_order_no: null,
      order_status: "confirmed",
      quantity: fields.quantity,
      desired_deadline: fields.desired,
      confirmed_deadline: fields.confirmed,
      product_name: fields.product,
      customer_name: fields.customer,
      customer_alias: fields.alias ?? null,
      process_name: s.process,
      sequence_order: s.seq,
      equipment_name: null,
      equipment_group_id: GROUP_IDS[s.group],
      equipment_group_name: s.group,
      process_start_datetime: processStart,
      process_end_datetime: processEnd,
      order_start_datetime: orderStart,
      order_end_datetime: orderEnd,
    }
  })
}

const SCHEDULES = [
  order(
    {
      orderId: 9101,
      orderNumber: "E2E-A",
      customer: CUSTOMER_FULL_NAME,
      alias: ALIAS,
      product: "E2E製品A φ10.0×20L SUS304 長い品名の例 両端面取り加工",
      quantity: 500,
      desired: "2026-09-30",
      confirmed: "2026-09-25",
    },
    [
      // 工程順と開始日時の順が逆（工程順で並ぶことを確かめる）
      { id: 101, routingId: 11, seq: 2, process: "カシメ", group: "カシメ機", start: jst(9, 15, "09:00"), end: jst(9, 15, "17:00") },
      { id: 102, routingId: 12, seq: 1, process: "プレス", group: "ワシノ25t", start: jst(9, 15, "13:00"), end: jst(9, 15, "17:00") },
      { id: 103, routingId: 13, seq: 3, process: "検査", group: "検査機", start: jst(9, 16, "09:00"), end: jst(9, 16, "12:00") },
    ],
  ),
  // 顧客不明・希望納期なし（完成見込み）・注文番号なし。前週から続き、翌週へ続く
  order(
    {
      orderId: 9102,
      orderNumber: null,
      customer: null,
      product: "E2E製品B",
      quantity: 1200,
      desired: null,
      confirmed: "2026-09-24",
      extent: [jst(9, 10, "09:00"), jst(9, 23, "17:00")],
      processExtents: {
        21: [jst(9, 10, "09:00"), jst(9, 14, "17:00")],
        22: [jst(9, 17, "09:00"), jst(9, 23, "17:00")],
      },
    },
    [
      { id: 201, routingId: 21, seq: 1, process: "内職", group: "内職", start: jst(9, 14, "09:00"), end: jst(9, 14, "17:00") },
      { id: 202, routingId: 22, seq: 2, process: "組立", group: "組立G", start: jst(9, 17, "09:00"), end: jst(9, 18, "17:00") },
    ],
  ),
].flat()

test.use({ timezoneId: "Asia/Tokyo" })

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 })
  await page.waitForLoadState("networkidle")
}

async function openSchedule(page: Page) {
  await page.clock.setFixedTime(NOW)
  await page.route(/\/production-schedules\?/, (route) => route.fulfill({ json: SCHEDULES }))
  await page.route(/\/calendars\?/, (route) => route.fulfill({ json: [] }))
  await page.route(/\/daily-reports\/order-progress/, (route) =>
    route.fulfill({ json: { computed_at: null, items: [] } }),
  )
  await login(page)
  await page.goto("/schedule")
  await expect(page.getByText(ALIAS).first()).toBeVisible({ timeout: 15000 })
}

/** ツールバーのセグメントボタン（表示単位・期間。Issue #581 で Select から変更）を選ぶ */
async function selectOption(page: Page, groupLabel: string, option: string) {
  const radio = page.getByRole("radiogroup", { name: groupLabel }).getByRole("radio", { name: option, exact: true })
  await radio.click()
  await expect(radio).toHaveAttribute("aria-checked", "true")
}

async function screenshot(page: Page, name: string) {
  // 時刻を固定しているため SSR とのハイドレーション不一致が出る。開発用オーバーレイのバッジは写さない
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" })
  await page.screenshot({ path: `test-results/gantt-order-labels/${name}.png` })
}

const rowLabels = (page: Page) => page.getByTestId("gantt-row-label")

/**
 * ラベルの1行目（`p`、1行で省略する）の先頭 `length` 文字が省略されずに見えているか。
 * 文字の範囲の右端が `p` の右端に収まっていれば、省略記号（…）より前にある
 */
async function leadingCharsFit(label: ReturnType<Page["getByTestId"]>, length: number): Promise<boolean> {
  return label.locator("p").first().evaluate((p, n) => {
    const range = document.createRange()
    range.setStart(p.firstChild!, 0)
    range.setEnd(p.firstChild!, n)
    return range.getBoundingClientRect().right <= p.getBoundingClientRect().right + 0.5
  }, length)
}

for (const viewport of [
  { width: 1180, height: 820 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`注文行・工程行のラベル（${viewport.width}×${viewport.height}）`, () => {
    test.use({ viewport })

    test("オーダー別: 注文行は通称・製品・数量の2行、工程行は工程順", async ({ page }) => {
      await openSchedule(page)
      await screenshot(page, `${viewport.width}-week-order`)

      // 注文は表示中の最初の開始が早い順（B: 9/14 → A: 9/15）
      const labels = await rowLabels(page).allTextContents()
      expect(labels[0]).toBe("顧客不明E2E製品B1,200個")
      expect(labels.slice(1, 3)).toEqual(["内職内職", "組立組立G"])
      // 正式名称・納期・注文番号はラベルに出さない（Issue #589）
      expect(labels[3]).toContain(ALIAS)
      expect(labels[3]).toContain("500個")
      expect(labels[3]).not.toContain("株式会社")
      expect(labels[3]).not.toContain("納期")
      expect(labels[3]).not.toContain("E2E-A")

      // 注文行は行の高さ（48px）に収まり、長い製品名は1行で省略して数量は切らない
      const orderA = rowLabels(page).nth(3)
      expect((await orderA.boundingBox())!.height).toBeLessThanOrEqual(48)
      expect(await leadingCharsFit(orderA, ALIAS.length)).toBe(true)
      await expect(orderA.getByText("500個", { exact: true })).toBeInViewport()
      // 工程順（開始日時の順ではない）
      expect(labels.slice(4, 7)).toEqual(["プレスワシノ25t", "カシメカシメ機", "検査検査機"])

      // 注文行のサマリーバーは工程バーより明らかに細い
      const summary = page.locator('[data-task-id="group-order-9101"]')
      const processBar = page.locator('[data-task-id="schedule-102"]')
      const summaryHeight = (await summary.boundingBox())!.height
      const processHeight = (await processBar.boundingBox())!.height
      expect(summaryHeight).toBeLessThan(processHeight / 2)

      // 前週から続き翌週へ続く注文・工程には続きの印
      const continued = page.locator('[data-task-id="group-order-9102"]')
      await expect(continued).toHaveAttribute("data-continues-before", "true")
      await expect(continued).toHaveAttribute("data-continues-after", "true")
      await expect(page.locator('[data-task-id="schedule-201"]')).toHaveAttribute("data-continues-before", "true")
      await expect(page.locator('[data-task-id="schedule-202"]')).toHaveAttribute("data-continues-after", "true")
    })

    test("注文行を個別に・まとめて折りたためる", async ({ page }) => {
      await openSchedule(page)
      await expect(rowLabels(page)).toHaveCount(7)

      // 注文B（工程2つ）を折りたたむ
      await page.getByRole("button", { name: "折りたたむ", exact: true }).first().click()
      await expect(rowLabels(page)).toHaveCount(5)

      await page.getByRole("button", { name: "すべて折りたたむ" }).click()
      await expect(rowLabels(page)).toHaveCount(2)
      await screenshot(page, `${viewport.width}-week-collapsed`)

      await page.getByRole("button", { name: "すべて展開" }).click()
      await expect(rowLabels(page)).toHaveCount(7)
    })

    test("設備グループ別・フラット: 工程行にどの注文（顧客・製品）の工程かを出す", async ({ page }) => {
      await openSchedule(page)

      await selectOption(page, "表示単位", "設備グループ別")
      await screenshot(page, `${viewport.width}-week-equipment-group`)
      // グループ行（5グループ）＋工程行（5行）
      await expect(rowLabels(page)).toHaveCount(10)
      const pressRow = rowLabels(page).filter({ hasText: "プレス" }).first()
      await expect(pressRow).toContainText(`${ALIAS} E2E製品A`)
      // 通称（全角6文字）は省略されず、続けて製品名も読める（子行のインデントがあり最も狭い。Issue #589）
      expect(await leadingCharsFit(pressRow, ALIAS.length + 1 + 8)).toBe(true)

      await selectOption(page, "表示単位", "フラット")
      await screenshot(page, `${viewport.width}-week-flat`)
      await expect(rowLabels(page).filter({ hasText: "内職" })).toContainText("顧客不明 E2E製品B")
    })

    test("凡例は1回のタップで開閉し、行のタップでは閉じず、開閉を覚える（Issue #589）", async ({ page }) => {
      await openSchedule(page)
      const toggle = page.getByRole("button", { name: "凡例", exact: true })
      const legend = page.getByRole("region", { name: "凡例" })

      // 初回（保存値なし）は開いている
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
      await expect(legend).toBeVisible()
      await screenshot(page, `${viewport.width}-legend-open`)

      // 注文行をタップして詳細シートを開いても、凡例は閉じない
      await rowLabels(page).nth(3).click()
      const sheet = page.getByRole("complementary", { name: "注文の詳細" })
      await expect(sheet).toContainText(`${CUSTOMER_FULL_NAME}（${ALIAS}）`)
      await expect(legend).toBeVisible()

      await toggle.click()
      await expect(legend).toBeHidden()
      await expect(toggle).toHaveAttribute("aria-expanded", "false")
      await screenshot(page, `${viewport.width}-legend-closed`)

      // 開き直しても閉じたまま（端末ごとに覚える）
      await page.reload()
      await expect(page.getByText(ALIAS).first()).toBeVisible({ timeout: 15000 })
      await expect(page.getByRole("button", { name: "凡例", exact: true })).toHaveAttribute("aria-expanded", "false")

      await page.getByRole("button", { name: "凡例", exact: true }).click()
      await expect(legend).toBeVisible()
      await legend.getByRole("button", { name: "凡例を閉じる" }).click()
      await expect(legend).toBeHidden()
    })
  })
}
