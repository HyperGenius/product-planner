import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { CreateProductDialog } from "./create-product-dialog"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/** 製品の作成ダイアログ（製品マスタ画面・日報の製品の行で共有。Issue #705）。品名・図番はダミー値 */

function mockApi({ fail = false }: { fail?: boolean } = {}) {
  const created: unknown[] = []
  server.use(
    http.get(`${API_BASE}/products/similar`, () => HttpResponse.json({ products: [] })),
    http.post(`${API_BASE}/products`, async ({ request }) => {
      if (fail) return HttpResponse.json({ detail: "error" }, { status: 500 })
      const body = (await request.json()) as { name: string; code: string }
      created.push(body)
      return HttpResponse.json({ id: 9, ...body }, { status: 201 })
    }),
  )
  return created
}

describe("CreateProductDialog", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it("製品マスタ画面の既定: 空の入力から作り、作った製品を渡して閉じる", async () => {
    const created = mockApi()
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()

    render(<CreateProductDialog open onOpenChange={onOpenChange} onCreated={onCreated} />)

    const dialog = await screen.findByRole("dialog", { name: "製品の新規作成" })
    expect(within(dialog).getByLabelText("図番 *")).toHaveValue("")
    await userEvent.type(within(dialog).getByLabelText("図番 *"), " A-001 ")
    await userEvent.type(within(dialog).getByLabelText("品名 *"), "製品A")
    await userEvent.click(within(dialog).getByRole("button", { name: "作成" }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(created).toEqual([{ name: "製品A", code: "A-001" }])
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 9, name: "製品A" }))
    // 説明文は出さない（UI文言ガイドライン）
    expect(dialog).not.toHaveTextContent("必要な情報を入力してください")
  })

  it("図番・品名が空なら作らずに知らせる", async () => {
    const created = mockApi()

    render(<CreateProductDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />)
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "作成" }))
    expect(toast.error).toHaveBeenCalledWith("図番を入力してください")

    await userEvent.type(within(dialog).getByLabelText("図番 *"), "A-001")
    await userEvent.click(within(dialog).getByRole("button", { name: "作成" }))
    expect(toast.error).toHaveBeenCalledWith("品名を入力してください")
    expect(created).toEqual([])
  })

  it("作成に失敗したら開いたままにし、作成後の処理を呼ばない", async () => {
    mockApi({ fail: true })
    const onCreated = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <CreateProductDialog
        open
        onOpenChange={onOpenChange}
        initialValues={{ name: "製品A", code: "A-001" }}
        onCreated={onCreated}
      />,
    )
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "作成" }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("製品の作成に失敗しました"))
    expect(onCreated).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("作成後の処理が終わるまで登録中のまま待ってから閉じる", async () => {
    mockApi()
    let finish!: () => void
    const onCreated = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const onOpenChange = vi.fn()

    render(
      <CreateProductDialog
        open
        onOpenChange={onOpenChange}
        initialValues={{ name: "製品A", code: "A-001" }}
        submittingLabel="登録中..."
        onCreated={onCreated}
      />,
    )
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: "作成" }))

    expect(await within(dialog).findByRole("button", { name: "登録中..." })).toBeDisabled()
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
