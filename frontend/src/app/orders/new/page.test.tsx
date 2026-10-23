import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import NewOrderPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}))

/**
 * 新規受注フォームの作業開始日の初期値が「翌日（JST）」になることの回帰テスト（Issue #477）。
 */
describe("NewOrderPage 作業開始日の初期値", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API_BASE}/tenant/members/me`, () =>
        HttpResponse.json({
          user_id: "u-1",
          email: "member@example.com",
          full_name: "テスト メンバー",
          role: "order_handler",
        }),
      ),
      http.get(`${API_BASE}/equipment-groups`, () => HttpResponse.json([])),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("JST の翌日が初期値になる（UTC では前日の深夜でも JST 基準）", () => {
    // 2026-09-29T16:30Z == JST 2026-09-30 01:30 → 翌日は 2026-10-01
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-09-29T16:30:00Z"))

    render(<NewOrderPage />)

    expect(screen.getByLabelText("作業開始日（任意）")).toHaveValue("2026-10-01")
    expect(
      screen.getByText(/指定した日から着手する前提でスケジュールを計算します/),
    ).toBeInTheDocument()
  })
})

/**
 * 修理・メンテナンス・洗浄など、製品を持たない注文の起票（Issue #494）。
 */
describe("NewOrderPage 修理等の起票", () => {
  beforeEach(() => {
    server.use(
      http.get(`${API_BASE}/tenant/members/me`, () =>
        HttpResponse.json({
          user_id: "u-1",
          email: "member@example.com",
          full_name: "テスト メンバー",
          role: "order_handler",
        }),
      ),
      http.get(`${API_BASE}/equipment-groups`, () => HttpResponse.json([])),
    )
  })

  it("修理等に切り替えると、製品・数量の代わりに件名・作業内容を入力させる", async () => {
    const user = userEvent.setup()
    render(<NewOrderPage />)

    expect(screen.queryByLabelText(/件名・作業内容/)).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "修理等" }))

    expect(screen.getByLabelText(/件名・作業内容/)).toBeInTheDocument()
    expect(screen.getByLabelText("実施開始日")).toBeInTheDocument()
    expect(screen.getByLabelText("完了予定日")).toBeInTheDocument()
    expect(screen.queryByLabelText("数量 *")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /シミュレーション/ })).not.toBeInTheDocument()
  })

  it("件名が空のままでは登録せず、製品・数量なしの修理として POST する", async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.post(`${API_BASE}/orders`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ id: 99, order_type: "repair" })
      }),
    )
    render(<NewOrderPage />)
    await user.click(screen.getByRole("button", { name: "修理等" }))

    await user.click(screen.getByRole("button", { name: "下書きとして登録" }))
    expect(body).toBeNull()

    await user.type(screen.getByLabelText(/件名・作業内容/), "洗浄作業")
    await user.click(screen.getByRole("button", { name: "下書きとして登録" }))

    await vi.waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ order_type: "repair", work_description: "洗浄作業" })
    expect(body).not.toHaveProperty("product_id")
    expect(body).not.toHaveProperty("quantity")
  })
})
