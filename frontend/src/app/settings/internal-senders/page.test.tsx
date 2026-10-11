import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { InternalSender } from "@/types/internal-sender"
import InternalSendersPage from "./page"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/** 社内転送者の管理画面（Issue #521）。アドレスはダミー */

const SENDER: InternalSender = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "president@example.com",
  created_at: "2026-10-11T00:00:00Z",
}

function mockApi(senders: InternalSender[] = [SENDER]) {
  const posts: unknown[] = []
  const deletes: string[] = []
  server.use(
    http.get(`${API_BASE}/tenant/internal-senders`, () => HttpResponse.json(senders)),
    http.post(`${API_BASE}/tenant/internal-senders`, async ({ request }) => {
      posts.push(await request.json())
      return HttpResponse.json(SENDER, { status: 201 })
    }),
    http.delete(`${API_BASE}/tenant/internal-senders/:id`, ({ params }) => {
      deletes.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return { posts, deletes }
}

describe("InternalSendersPage", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it("登録済みのアドレスを一覧に出す", async () => {
    mockApi()
    render(<InternalSendersPage />)

    expect(await screen.findByText("president@example.com")).toBeInTheDocument()
  })

  it("入力したアドレスを登録する", async () => {
    const { posts } = mockApi([])
    render(<InternalSendersPage />)

    await screen.findByText("社内転送者は登録されていません")
    await userEvent.type(screen.getByLabelText("メールアドレス"), " office@example.com ")
    await userEvent.click(screen.getByRole("button", { name: "登録" }))

    await waitFor(() => expect(posts).toEqual([{ email: "office@example.com" }]))
    expect(toast.success).toHaveBeenCalledWith("社内転送者を登録しました")
  })

  it("登録済みのアドレスは重複として知らせる", async () => {
    mockApi([])
    server.use(
      http.post(`${API_BASE}/tenant/internal-senders`, () =>
        HttpResponse.json(
          { detail: { error: "duplicate_internal_sender", message: "dup" } },
          { status: 409 },
        ),
      ),
    )
    render(<InternalSendersPage />)

    await userEvent.type(await screen.findByLabelText("メールアドレス"), "president@example.com")
    await userEvent.click(screen.getByRole("button", { name: "登録" }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("このメールアドレスは既に登録されています"),
    )
  })

  it("確認ダイアログで解除する", async () => {
    const { deletes } = mockApi()
    render(<InternalSendersPage />)

    await userEvent.click(
      await screen.findByRole("button", { name: "president@example.comの登録を解除" }),
    )
    await userEvent.click(screen.getByRole("button", { name: "解除する" }))

    await waitFor(() => expect(deletes).toEqual([SENDER.id]))
    expect(toast.success).toHaveBeenCalledWith("社内転送者の登録を解除しました")
  })

  it("権限が無い場合は管理者のみと表示する", async () => {
    server.use(
      http.get(`${API_BASE}/tenant/internal-senders`, () =>
        HttpResponse.json({ detail: "forbidden" }, { status: 403 }),
      ),
    )
    render(<InternalSendersPage />)

    expect(await screen.findByText("この画面は管理者のみアクセスできます")).toBeInTheDocument()
  })
})
