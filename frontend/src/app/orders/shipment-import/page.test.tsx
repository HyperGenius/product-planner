import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import ShipmentImportPage from "./page"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/shipment-import",
}))

// jsdom の File には arrayBuffer() が無い（ブラウザには有る）ので、このファイルだけ補う
if (typeof File.prototype.arrayBuffer !== "function") {
  File.prototype.arrayBuffer = function (this: File) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

const member = (role: string) =>
  http.get(`${API_BASE}/tenant/members/me`, () => HttpResponse.json({ user_id: "u1", role }))

const notParsed = {
  parse_status: "pending",
  parse_error: null,
  parsed_at: null,
  period_start: null,
  period_end: null,
  entry_count: null,
  skipped_count: null,
  replace_result: null,
}

const list = {
  last_received_at: "2026-11-09T08:00:00+00:00",
  files: [
    {
      id: "a",
      file_name: "売上明細.xlsx",
      source: "agent",
      size_bytes: 2048,
      received_at: "2026-11-09T08:00:00+00:00",
      ...notParsed,
      parse_status: "parsed",
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      entry_count: 98,
      skipped_count: 0,
      replace_result: "replaced",
    },
    {
      id: "b",
      file_name: "手動.csv",
      source: "web",
      size_bytes: 10,
      received_at: "2026-11-01T08:00:00+00:00",
      ...notParsed,
      parse_status: "unsupported",
      parse_error: "unsupported_file_type",
    },
    {
      id: "c",
      file_name: "見出し違い.xlsx",
      source: "web",
      size_bytes: 10,
      received_at: "2026-10-31T08:00:00+00:00",
      ...notParsed,
      parse_status: "failed",
      parse_error: "header_not_found",
    },
  ],
}

describe("ShipmentImportPage", () => {
  it("最終取り込み日時と取り込み済みファイルを経路つきで表示する", async () => {
    server.use(member("order_handler"), http.get(`${API_BASE}/shipment-files`, () => HttpResponse.json(list)))
    render(<ShipmentImportPage />)
    expect(await screen.findByText("売上明細.xlsx")).toBeInTheDocument()
    expect(screen.getByText("共有フォルダ")).toBeInTheDocument()
    expect(screen.getAllByText("アップロード")).toHaveLength(2)
    expect(screen.getByText(/最終取り込み:/)).toHaveTextContent("11/9")
  })

  it("ファイルごとに期間・明細の件数・解析エラーを表示する", async () => {
    server.use(member("order_handler"), http.get(`${API_BASE}/shipment-files`, () => HttpResponse.json(list)))
    render(<ShipmentImportPage />)
    expect(await screen.findByText("98行")).toBeInTheDocument()
    expect(screen.getByText("10/1〜10/31")).toBeInTheDocument()
    expect(screen.getByText("Excel（.xlsx）以外のファイルは解析しません")).toBeInTheDocument()
    expect(
      screen.getByText("見出し（得意先コード・商品コード等）を読めませんでした"),
    ).toBeInTheDocument()
  })

  it("未取り込みのときはその旨を表示する", async () => {
    server.use(member("order_handler"))
    render(<ShipmentImportPage />)
    expect(await screen.findByText("まだ取り込まれたファイルはありません")).toBeInTheDocument()
    expect(screen.getByText(/最終取り込み:/)).toHaveTextContent("未取り込み")
  })

  it("CSV を選ぶとサーバーへ octet-stream で送る", async () => {
    let received: { name: string | null; type: string | null; text: string } | null = null
    server.use(
      member("order_handler"),
      http.post(`${API_BASE}/shipment-files`, async ({ request }) => {
        received = {
          name: request.headers.get("X-File-Name"),
          type: request.headers.get("Content-Type"),
          text: await request.text(),
        }
        return HttpResponse.json({ status: "stored", sha256: "x" })
      }),
    )
    render(<ShipmentImportPage />)
    const input = await screen.findByLabelText("売上伝票のファイルを選択")
    await userEvent.upload(input, new File(["a,b\n1,2\n"], "売上伝票.csv", { type: "text/csv" }))
    await waitFor(() => expect(received).not.toBeNull())
    expect(received!.name).toBe(encodeURIComponent("売上伝票.csv"))
    expect(received!.type).toBe("application/octet-stream")
    expect(received!.text).toBe("a,b\n1,2\n")
  })

  it("対象外の拡張子のファイルは送らずに理由を表示する", async () => {
    const post = vi.fn()
    server.use(
      member("order_handler"),
      http.post(`${API_BASE}/shipment-files`, () => {
        post()
        return HttpResponse.json({ status: "stored", sha256: "x" })
      }),
    )
    render(<ShipmentImportPage />)
    const input = await screen.findByLabelText("売上伝票のファイルを選択")
    await userEvent.upload(input, new File(["x"], "売上.pdf"), { applyAccept: false })
    expect(await screen.findByRole("alert")).toHaveTextContent(".xlsx / .csv / .txt")
    expect(post).not.toHaveBeenCalled()
  })

  it("アップロードできないロール（受注担当・社長以外）にはボタンを出さない", async () => {
    server.use(member("iso_officer"))
    render(<ShipmentImportPage />)
    await screen.findByText("まだ取り込まれたファイルはありません")
    expect(screen.queryByLabelText("売上伝票のファイルを選択")).not.toBeInTheDocument()
  })
})
