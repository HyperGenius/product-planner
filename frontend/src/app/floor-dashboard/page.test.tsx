import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import FloorDashboardPage from "./page"

/**
 * 現場ダッシュボード（Issue #440）の器の描画を検証する。
 * KPI等の中身は後続Issueで差し込まれるため、ここではタイトル・注記バナー・
 * 最終更新時刻の表示（取得成功後に更新されること）のみを確認する。
 */

function mockOrders(): void {
  server.use(http.get(`${API_BASE}/orders`, () => HttpResponse.json([])))
}

function mockOrdersError(): void {
  server.use(http.get(`${API_BASE}/orders`, () => new HttpResponse(null, { status: 500 })))
}

describe("FloorDashboardPage", () => {
  it("画面タイトルとフェーズ1注記バナーを表示する", async () => {
    mockOrders()
    render(<FloorDashboardPage />)

    expect(
      screen.getByRole("heading", { name: "受注・出荷ダッシュボード" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "フェーズ1: 計画データのみ表示中。現場実績はまだ未連携です。",
      ),
    ).toBeInTheDocument()
  })

  it("受注データの取得成功後に最終更新時刻を表示する", async () => {
    mockOrders()
    render(<FloorDashboardPage />)

    expect(screen.getByText(/取得中\.\.\./)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText(/取得中\.\.\./)).not.toBeInTheDocument()
    })
    expect(screen.getByText(/最終更新:/)).toBeInTheDocument()
  })

  it("受注データの取得に失敗したらエラー表示に切り替わる（常時表示画面での障害検知用）", async () => {
    mockOrdersError()
    render(<FloorDashboardPage />)

    await waitFor(() => {
      expect(screen.getByText(/データ取得に失敗しました/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/取得中\.\.\./)).not.toBeInTheDocument()
  })
})
