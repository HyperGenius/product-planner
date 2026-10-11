import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Customer } from "@/types/customer"
import CustomersPage from "./page"

/** 顧客マスタの編集で任意項目を空欄にすると消せる (Issue #517)。値はダミー */

const CUSTOMER: Customer = {
  id: 1,
  name: "テスト顧客A",
  alias: "A社",
  representative_name: "代表 太郎",
  phone_number: "03-0000-0000",
  email: "contact@example.com",
  status: "active",
  tenant_id: "tenant-1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

function mockCustomers() {
  const patches: unknown[] = []
  server.use(
    http.get(`${API_BASE}/customers`, () => HttpResponse.json([CUSTOMER])),
    http.patch(`${API_BASE}/customers/:id`, async ({ request }) => {
      patches.push(await request.json())
      return HttpResponse.json(CUSTOMER)
    }),
  )
  return patches
}

async function openEditDialog() {
  await userEvent.click(await screen.findByRole("button", { name: "テスト顧客Aを編集" }))
}

describe("CustomersPage", () => {
  it("編集で空欄にした任意項目を null で送る", async () => {
    const patches = mockCustomers()
    render(<CustomersPage />)

    await openEditDialog()
    await userEvent.clear(screen.getByLabelText("Email"))
    await userEvent.clear(screen.getByLabelText("通称"))
    // 空白だけの入力も空欄として扱う
    await userEvent.clear(screen.getByLabelText("電話番号"))
    await userEvent.type(screen.getByLabelText("電話番号"), "  ")
    await userEvent.click(screen.getByRole("button", { name: "更新" }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({
      name: "テスト顧客A",
      alias: null,
      representative_name: "代表 太郎",
      phone_number: null,
      fax_number: null,
      email: null,
    })
  })

  it("空欄にしていない項目はそのまま送る", async () => {
    const patches = mockCustomers()
    render(<CustomersPage />)

    await openEditDialog()
    await userEvent.clear(screen.getByLabelText("Email"))
    await userEvent.type(screen.getByLabelText("Email"), "new@example.com")
    await userEvent.click(screen.getByRole("button", { name: "更新" }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toEqual({
      name: "テスト顧客A",
      alias: "A社",
      representative_name: "代表 太郎",
      phone_number: "03-0000-0000",
      fax_number: null,
      email: "new@example.com",
    })
  })

  it("FAX番号を入力すると送る（注文書の送信元番号での照合用。Issue #521）", async () => {
    const patches = mockCustomers()
    render(<CustomersPage />)

    await openEditDialog()
    await userEvent.type(screen.getByLabelText("FAX番号"), "03-0000-0001")
    await userEvent.click(screen.getByRole("button", { name: "更新" }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toMatchObject({ fax_number: "03-0000-0001" })
  })
})
