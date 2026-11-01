import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Customer, CustomerContact } from "@/types/customer"
import type { MemberRole } from "@/types/member"
import { CustomerContactsDialog } from "./customer-contacts-dialog"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/** 顧客の担当者の一覧・追加・削除（Issue #611）。アドレス・名前はダミー */

const CUSTOMER: Customer = {
  id: 1,
  name: "テスト顧客A",
  status: "active",
  tenant_id: "tenant-1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

const CONTACT: CustomerContact = {
  id: "11111111-1111-1111-1111-111111111111",
  customer_id: 1,
  email: "buyer@example.com",
  contact_name: "購買 太郎",
  created_at: "2026-11-01T00:00:00Z",
}

function mockApi(role: MemberRole = "order_handler", contacts = [CONTACT]) {
  const posts: unknown[] = []
  const deletes: string[] = []
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role }),
    ),
    http.get(`${API_BASE}/customers/1/contacts`, () => HttpResponse.json(contacts)),
    http.post(`${API_BASE}/customers/1/contacts`, async ({ request }) => {
      posts.push(await request.json())
      return HttpResponse.json(CONTACT, { status: 201 })
    }),
    http.delete(`${API_BASE}/customers/1/contacts/:id`, ({ params }) => {
      deletes.push(String(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return { posts, deletes }
}

describe("CustomerContactsDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("担当者の登録名とアドレスを一覧する", async () => {
    mockApi()
    render(<CustomerContactsDialog customer={CUSTOMER} onOpenChange={() => {}} />)

    expect(await screen.findByText("buyer@example.com")).toBeInTheDocument()
    expect(screen.getByText("購買 太郎")).toBeInTheDocument()
  })

  it("担当者を追加する（登録名は空なら null）", async () => {
    const { posts } = mockApi()
    render(<CustomerContactsDialog customer={CUSTOMER} onOpenChange={() => {}} />)

    await screen.findByText("buyer@example.com")
    await userEvent.type(screen.getByLabelText("メールアドレス *"), " new@example.com ")
    await userEvent.click(screen.getByRole("button", { name: "追加" }))

    await waitFor(() => expect(posts).toHaveLength(1))
    expect(posts[0]).toEqual({ email: "new@example.com", contact_name: null })
  })

  it("担当者を削除する", async () => {
    const { deletes } = mockApi()
    render(<CustomerContactsDialog customer={CUSTOMER} onOpenChange={() => {}} />)

    await userEvent.click(await screen.findByRole("button", { name: "buyer@example.comを削除" }))

    await waitFor(() => expect(deletes).toEqual([CONTACT.id]))
  })

  it("別の顧客に登録済みのアドレスは登録先の顧客名を示して拒否する", async () => {
    mockApi()
    server.use(
      http.post(`${API_BASE}/customers/1/contacts`, () =>
        HttpResponse.json(
          {
            detail: {
              error: "duplicate_contact_email",
              message: "このメールアドレスは「テスト顧客B」に登録済みです",
              conflicting_customer: { id: 2, name: "テスト顧客B" },
            },
          },
          { status: 409 },
        ),
      ),
    )
    render(<CustomerContactsDialog customer={CUSTOMER} onOpenChange={() => {}} />)

    await screen.findByText("buyer@example.com")
    await userEvent.type(screen.getByLabelText("メールアドレス *"), "dup@example.com")
    await userEvent.click(screen.getByRole("button", { name: "追加" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("「テスト顧客B」に登録済み")
  })

  it("編集権限の無いロールには追加・削除の操作を出さない", async () => {
    mockApi("iso_officer")
    render(<CustomerContactsDialog customer={CUSTOMER} onOpenChange={() => {}} />)

    await screen.findByText("buyer@example.com")
    await waitFor(() => expect(screen.queryByLabelText("メールアドレス *")).not.toBeInTheDocument())
    expect(screen.queryByRole("button", { name: "buyer@example.comを削除" })).not.toBeInTheDocument()
  })
})
