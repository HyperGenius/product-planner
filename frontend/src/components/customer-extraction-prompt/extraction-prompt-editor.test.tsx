import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type {
  ExtractionPreview,
  ExtractionPromptHistoryItem,
  PreviewReading,
} from "@/types/customer-extraction-prompt"
import { ExtractionPromptEditor } from "./extraction-prompt-editor"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

/** 顧客ごとの抽出指示の編集・試し読み（Issue #602）。顧客名・指示はダミー */

const BASE = `${API_BASE}/customers/7/extraction-prompt`
const ATTACHMENT_ID = "22222222-2222-2222-2222-222222222222"

const READING: PreviewReading = {
  error: null,
  document_order_no: "C100",
  is_repair: false,
  subject: null,
  line_items: [
    {
      product_name_raw: "部品A",
      product_number_raw: "A-1",
      quantity: 10,
      invalid_quantity: false,
      delivery_date: "2026-11-01",
      certainty: "confirmed",
      line_order_no: null,
      customer_order_no: "C100",
      product: { id: 42, code: "A-1", name: "部品A" },
    },
  ],
  fallback: null,
}

const HISTORY: ExtractionPromptHistoryItem[] = [
  { id: 2, prompt: "今の指示", changed_by: "u-1", changed_at: "2026-10-30T01:00:00Z" },
  { id: 1, prompt: "前の指示", changed_by: null, changed_at: "2026-10-29T01:00:00Z" },
]

interface Captured {
  puts: unknown[]
  previews: unknown[]
}

function mockApi(options: { prompt?: string | null; preview?: () => Response } = {}): Captured {
  const captured: Captured = { puts: [], previews: [] }
  let prompt = options.prompt === undefined ? "今の指示" : options.prompt
  server.use(
    http.get(BASE, () =>
      HttpResponse.json({ customer_id: 7, customer_name: "顧客A社", prompt, max_length: 2000 }),
    ),
    http.put(BASE, async ({ request }) => {
      const body = (await request.json()) as { prompt: string | null }
      captured.puts.push(body)
      prompt = body.prompt
      return HttpResponse.json({ prompt, changed: true })
    }),
    http.get(`${BASE}/history`, () => HttpResponse.json(HISTORY)),
    http.get(`${BASE}/attachments`, () =>
      HttpResponse.json([
        {
          id: ATTACHMENT_ID,
          original_filename: "注文書.pdf",
          size_bytes: 1234,
          received_at: "2026-10-01T00:00:00Z",
        },
      ]),
    ),
    http.get(`${API_BASE}/tenant/members`, () =>
      HttpResponse.json([
        { user_id: "u-1", email: "admin@example.com", full_name: "運用担当", role: "platform_admin" },
      ]),
    ),
    http.post(`${BASE}/preview`, async ({ request }) => {
      captured.previews.push(await request.json())
      if (options.preview) return options.preview()
      const preview: ExtractionPreview = {
        source: "text",
        unreadable_reason: null,
        current: READING,
        edited: { ...READING, document_order_no: "C200" },
        same_prompt: false,
      }
      return HttpResponse.json(preview)
    }),
  )
  return captured
}

async function editor(): Promise<HTMLTextAreaElement> {
  return (await screen.findByLabelText("抽出指示")) as HTMLTextAreaElement
}

describe("ExtractionPromptEditor", () => {
  beforeEach(() => vi.clearAllMocks())

  it("今の指示を表示し、未編集のあいだは保存できない", async () => {
    mockApi()
    render(<ExtractionPromptEditor customerId={7} />)

    expect(await editor()).toHaveValue("今の指示")
    expect(screen.getByRole("heading", { name: "取り込み設定: 顧客A社" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
  })

  it("選んだPDFを編集中の指示で試し読みし、違う項目を強調する", async () => {
    const captured = mockApi()
    render(<ExtractionPromptEditor customerId={7} />)

    const textarea = await editor()
    await userEvent.clear(textarea)
    await userEvent.type(textarea, "  新しい指示 ")
    await userEvent.click(await screen.findByRole("radio", { name: /注文書\.pdf/ }))
    await userEvent.click(screen.getByRole("button", { name: "試し読み" }))

    const documentSection = await screen.findByRole("region", { name: "文書" })
    expect(captured.previews).toEqual([{ attachment_id: ATTACHMENT_ID, prompt: "新しい指示" }])
    const orderNoRow = within(documentSection).getByRole("row", { name: /文書の注文番号/ })
    expect(orderNoRow).toHaveAttribute("data-differs", "true")
    expect(orderNoRow).toHaveTextContent("C100")
    expect(orderNoRow).toHaveTextContent("C200")
    expect(screen.getByText("違いのある項目: 1")).toBeInTheDocument()

    // 試し読みのあとで編集すると、結果が古いことを示す
    await userEvent.type(textarea, "追記")
    expect(screen.getByText(/試し読みのあとで編集欄が変わっています/)).toBeInTheDocument()
  })

  it("PDFを選ぶまで試し読みできない", async () => {
    mockApi()
    render(<ExtractionPromptEditor customerId={7} />)

    await screen.findByRole("radio", { name: /注文書\.pdf/ })
    expect(screen.getByRole("button", { name: "試し読み" })).toBeDisabled()
  })

  it("空にして保存すると null を送る", async () => {
    const captured = mockApi()
    render(<ExtractionPromptEditor customerId={7} />)

    await userEvent.clear(await editor())
    await userEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(captured.puts).toEqual([{ prompt: null }]))
    expect(toast.success).toHaveBeenCalledWith("抽出指示を保存しました")
    await waitFor(() => expect(screen.getByLabelText("抽出指示")).toHaveValue(""))
  })

  it("上限を超えると保存・試し読みできない", async () => {
    mockApi({ prompt: null })
    render(<ExtractionPromptEditor customerId={7} />)

    const textarea = await editor()
    await userEvent.click(textarea)
    await userEvent.paste("あ".repeat(2001))

    expect(screen.getByText("2001 / 2000文字")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "試し読み" })).toBeDisabled()
  })

  it("履歴の版を編集欄に読み込める", async () => {
    mockApi()
    render(<ExtractionPromptEditor customerId={7} />)

    await userEvent.click(await screen.findByRole("button", { name: /画面以外で入った値/ }))
    expect(screen.getByText("前の指示")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "この版を編集欄に読み込む" }))

    expect(screen.getByLabelText("抽出指示")).toHaveValue("前の指示")
    expect(screen.getByRole("button", { name: "保存" })).toBeEnabled()
    // 変更者はメンバーの名前で出す
    expect(screen.getByRole("button", { name: /運用担当/ })).toBeInTheDocument()
  })

  it("回数制限などのエラーはバックエンドの文言を出す", async () => {
    mockApi({
      preview: () =>
        HttpResponse.json(
          { detail: { error: "preview_rate_limited", message: "試し読みの回数が多すぎます" } },
          { status: 429 },
        ),
    })
    render(<ExtractionPromptEditor customerId={7} />)

    await userEvent.click(await screen.findByRole("radio", { name: /注文書\.pdf/ }))
    await userEvent.click(screen.getByRole("button", { name: "試し読み" }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("試し読みの回数が多すぎます"),
    )
  })

  it("読めないPDFは理由を出す", async () => {
    mockApi({
      preview: () =>
        HttpResponse.json({
          source: null,
          unreadable_reason: "failed_encrypted",
          current: null,
          edited: null,
          same_prompt: true,
        }),
    })
    render(<ExtractionPromptEditor customerId={7} />)

    await userEvent.click(await screen.findByRole("radio", { name: /注文書\.pdf/ }))
    await userEvent.click(screen.getByRole("button", { name: "試し読み" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("パスワード付きのPDF")
  })
})
