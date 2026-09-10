import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { EmailIntakeResult } from "@/types/order"
import EmailIntakeResultsPage from "./page"

/**
 * 受信受注メールの処理結果を「起票 / スキップ / 失敗」の3値（サーバー導出の `outcome`）で
 * 表示することの回帰テスト（Issue #422 PR-2）。
 * かつて `parse_status='success'` を「パース成功」バッジで出していたため、
 * 「成功なのにスキップ理由あり・起票0件」が矛盾して見えていた。
 */

function makeResult(overrides: Partial<EmailIntakeResult>): EmailIntakeResult {
  return {
    id: "att-1",
    received_at: "2026-09-01T00:00:00+00:00",
    customer_id: 1,
    customer_name: "顧客A社",
    original_filename: "order.pdf",
    has_attachment: true,
    content_type: "application/pdf",
    parse_status: "success",
    gmail_message_id: "dummy_message_id_1",
    gmail_url: "https://mail.google.com/mail/u/0/#all/dummy_message_id_1",
    signed_url: "https://signed/1",
    created_order_count: 0,
    created_order_ids: [],
    parse_log_reasons: [],
    outcome: "skipped",
    needs_attention: false,
    empty_draft: false,
    ...overrides,
  }
}

function mockResults(rows: EmailIntakeResult[]): void {
  server.use(
    http.get(`${API_BASE}/orders/email-intake-results`, () =>
      HttpResponse.json(rows),
    ),
  )
}

function getRow(name: string | RegExp): HTMLElement {
  return screen.getByRole("row", { name }).closest("tr") as HTMLElement
}

describe("EmailIntakeResultsPage", () => {
  it("parse_status='success' でもスキップ理由あり・起票0件なら『スキップ』と表示する", async () => {
    mockResults([
      makeResult({
        outcome: "skipped",
        parse_log_reasons: ["non_order_email"],
      }),
    ])

    render(<EmailIntakeResultsPage />)

    const row = await waitFor(() => getRow(/顧客A社/))
    expect(within(row).getByText("スキップ")).toBeInTheDocument()
    expect(within(row).getByText("対象外メール")).toBeInTheDocument()
    // 旧仕様の「パース成功」バッジは出さない
    expect(screen.queryByText("パース成功")).not.toBeInTheDocument()
  })

  it("品番未照合でも下書きが起票された行は『起票 N件』＋『要確認』で表示する", async () => {
    mockResults([
      makeResult({
        outcome: "created",
        needs_attention: true,
        created_order_count: 1,
        created_order_ids: [1001],
        parse_log_reasons: ["no_product_match"],
      }),
    ])

    render(<EmailIntakeResultsPage />)

    const row = await waitFor(() => getRow(/顧客A社/))
    expect(within(row).getByText("起票 1件")).toBeInTheDocument()
    expect(within(row).getByText("要確認")).toBeInTheDocument()
    expect(within(row).getByText("品番照合失敗")).toBeInTheDocument()
    expect(within(row).getByRole("link", { name: "#1001" })).toHaveAttribute(
      "href",
      "/orders/1001",
    )
  })

  it("読み取り不能PDFの行は『失敗』＋空の下書きの注意書きを表示する", async () => {
    mockResults([
      makeResult({
        outcome: "failed",
        empty_draft: true,
        created_order_count: 1,
        created_order_ids: [1002],
        parse_log_reasons: ["failed_encrypted"],
      }),
    ])

    render(<EmailIntakeResultsPage />)

    const row = await waitFor(() => getRow(/顧客A社/))
    expect(within(row).getByText("失敗")).toBeInTheDocument()
    expect(within(row).getByText("暗号化PDF")).toBeInTheDocument()
    expect(within(row).getByText(/空の下書きを起票済み/)).toBeInTheDocument()
  })

  it("通常の起票行は件数と注文リンクを表示する", async () => {
    mockResults([
      makeResult({
        outcome: "created",
        created_order_count: 2,
        created_order_ids: [1003, 1004],
      }),
    ])

    render(<EmailIntakeResultsPage />)

    const row = await waitFor(() => getRow(/顧客A社/))
    expect(within(row).getByText("起票 2件")).toBeInTheDocument()
    expect(within(row).queryByText("要確認")).not.toBeInTheDocument()
    expect(within(row).getByRole("link", { name: "#1003" })).toBeInTheDocument()
    expect(within(row).getByRole("link", { name: "#1004" })).toBeInTheDocument()
  })

  it("結果が空なら空状態メッセージを表示する", async () => {
    mockResults([])

    render(<EmailIntakeResultsPage />)

    expect(
      await screen.findByText("受信受注メールはまだありません"),
    ).toBeInTheDocument()
  })
})
