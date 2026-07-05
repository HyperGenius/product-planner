import { test, expect, type Page, type Locator } from "@playwright/test"

/**
 * 前提:
 * - Supabase (supabase start), backend (uvicorn app.main:app --port 8000),
 *   frontend (npm run dev) がすべてローカルで起動していること
 * - E2E_USER_EMAIL / E2E_USER_PASSWORD で指定するユーザーが admin ロールを持つこと
 *   (工程の確定操作は admin のみ可能なため)
 */
const email = process.env.E2E_USER_EMAIL ?? "test@example.com"
const password = process.env.E2E_USER_PASSWORD ?? "Test123!"

const suffix = Date.now()
const products = {
  noProcess: { name: `E2E-NOPROC-${suffix}`, code: `e2e-noproc-${suffix}` },
  unconfirmed: { name: `E2E-UNCONF-${suffix}`, code: `e2e-unconf-${suffix}` },
  confirmed: { name: `E2E-CONF-${suffix}`, code: `e2e-conf-${suffix}` },
}

async function login(page: Page) {
  await page.goto("/login")
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 })
  await page.waitForLoadState("networkidle")
}

async function createProduct(page: Page, name: string, code: string) {
  await page.click("text=新規作成")
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible" })
  await page.fill("#create-name", name)
  await page.fill("#create-code", code)
  await dialog.getByRole("button", { name: "作成", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
}

async function openRoutingsDialog(page: Page, name: string) {
  const row = page.locator("tr", { hasText: name })
  await row.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: "工程管理" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible" })
  return dialog
}

async function addProcess(page: Page, dialog: Locator, processName: string) {
  await dialog.locator('input[placeholder="例: 切削加工"]').fill(processName)
  const select = dialog.locator("select")
  await select.selectOption({ label: "設備なし" })
  await dialog.getByRole("button", { name: "追加" }).click()
  await page.waitForTimeout(500)
}

async function deleteProduct(page: Page, name: string) {
  await page.goto("/master/products")
  await page.waitForLoadState("networkidle")
  const row = page.locator("tr", { hasText: name })
  if ((await row.count()) === 0) return
  await row.getByRole("button").last().click()
  await page.getByRole("menuitem", { name: "削除" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor({ state: "visible" })
  await dialog.getByRole("button", { name: "削除", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
}

test.describe("製品マスタ: 工程の確定状態表示", () => {
  test.afterEach(async ({ page }) => {
    for (const p of Object.values(products)) {
      await deleteProduct(page, p.name)
    }
  })

  test("工程未登録・未確定・確定済みの3状態が区別して表示される", async ({ page }) => {
    await login(page)

    await page.goto("/master/products")
    await page.waitForLoadState("networkidle")

    await createProduct(page, products.noProcess.name, products.noProcess.code)
    await createProduct(page, products.unconfirmed.name, products.unconfirmed.code)
    await createProduct(page, products.confirmed.name, products.confirmed.code)

    // 工程未登録: 「未登録」バッジ
    const noProcessRow = page.locator("tr", { hasText: products.noProcess.name })
    await expect(noProcessRow.getByText("未登録")).toBeVisible()

    // 工程あり・未確定: 「未確定あり」バッジ
    const unconfirmedDialog = await openRoutingsDialog(page, products.unconfirmed.name)
    await addProcess(page, unconfirmedDialog, "検査工程")
    await page.keyboard.press("Escape")
    await page.waitForTimeout(300)

    const unconfirmedRow = page.locator("tr", { hasText: products.unconfirmed.name })
    await expect(unconfirmedRow.getByText("未確定あり")).toBeVisible()

    // 工程あり・確定済み: 「確定済み」バッジ
    const confirmedDialog = await openRoutingsDialog(page, products.confirmed.name)
    await addProcess(page, confirmedDialog, "検査工程2")
    await confirmedDialog.getByRole("button", { name: "確定する" }).click()
    await page.waitForTimeout(500)
    await page.keyboard.press("Escape")
    await page.waitForTimeout(300)

    const confirmedRow = page.locator("tr", { hasText: products.confirmed.name })
    await expect(confirmedRow.getByText("確定済み")).toBeVisible()
  })
})
