import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen } from "@/test-utils/render"
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
