import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE, sampleProducts } from "@/test-utils/msw/handlers"
import type { ProcessRouting, UntrackedProcessName } from "@/types/process-routing"
import { ProductRoutingsDialog } from "./product-routings-dialog"

const PRODUCT = sampleProducts[0]

function routing(id: number, sequence_order: number, process_name: string): ProcessRouting {
  return {
    id,
    product_id: PRODUCT.id,
    process_name,
    equipment_group_id: null,
    sequence_order,
    setup_time_seconds: 0,
    unit_time_seconds: 1,
    is_confirmed: true,
    confirmed_by: null,
    confirmed_at: null,
    tenant_id: "tenant-1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  }
}

function setup(role: string, initial: UntrackedProcessName[] = []) {
  let untracked = [...initial]
  const posted: unknown[] = []
  const deleted: string[] = []
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role }),
    ),
    http.get(`${API_BASE}/process-routings`, () =>
      HttpResponse.json([routing(11, 1, "プレス"), routing(12, 2, "検査")]),
    ),
    http.get(`${API_BASE}/equipment-groups`, () => HttpResponse.json([])),
    http.post(`${API_BASE}/orders/simulate`, () => HttpResponse.json({ process_schedules: [] })),
    http.get(`${API_BASE}/untracked-process-names`, () => HttpResponse.json(untracked)),
    http.post(`${API_BASE}/untracked-process-names`, async ({ request }) => {
      const body = (await request.json()) as { process_name: string }
      posted.push(body)
      const row = { id: 9, process_name: body.process_name, created_at: "2026-11-15T00:00:00Z" }
      untracked = [...untracked, row]
      return HttpResponse.json(row, { status: 201 })
    }),
    http.delete(`${API_BASE}/untracked-process-names/:id`, ({ params }) => {
      deleted.push(String(params.id))
      untracked = untracked.filter((u) => String(u.id) !== params.id)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  render(<ProductRoutingsDialog product={PRODUCT} open onOpenChange={() => {}} />)
  return { posted, deleted }
}

function rowOf(processName: string): HTMLElement {
  return screen.getByRole("cell", { name: new RegExp(`^${processName}`) }).closest("tr")!
}

describe("ProductRoutingsDialog の日報で追わない工程（Issue #681）", () => {
  it("社長は工程を日報で追わない工程にでき、確認してから登録する", async () => {
    const { posted } = setup("president")
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "検査を日報で追わない工程にする" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("同じ工程名の工程を持つすべての製品に効きます")
    expect(posted).toEqual([])

    await user.click(within(dialog).getByRole("button", { name: "日報で追わない" }))

    await waitFor(() => expect(posted).toEqual([{ process_name: "検査" }]))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(await within(rowOf("検査")).findByText("日報の対象外")).toBeInTheDocument()
    expect(within(rowOf("検査")).getByRole("button", { name: "検査を日報で追う工程にする" })).toHaveTextContent(
      "追わない",
    )
    expect(within(screen.getByRole("list", { name: "日報で追わない工程" })).getByText("検査")).toBeInTheDocument()
  })

  it("一覧から設定を外せる", async () => {
    const { deleted } = setup("platform_admin", [
      { id: 3, process_name: "検査", created_at: "2026-11-15T00:00:00Z" },
    ])
    const user = userEvent.setup()

    await user.click(await screen.findByRole("button", { name: "検査を日報で追う工程に戻す" }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: "日報で追う" }))

    await waitFor(() => expect(deleted).toEqual(["3"]))
    expect(await screen.findByText("設定した工程はありません")).toBeInTheDocument()
  })

  it("受注担当は設定を見るだけで切り替えられない", async () => {
    setup("order_handler", [{ id: 3, process_name: "検査", created_at: "2026-11-15T00:00:00Z" }])

    expect(await within(await screen.findByRole("list", { name: "日報で追わない工程" })).findByText("検査")).toBeInTheDocument()
    expect(within(rowOf("検査")).getByText("追わない")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /日報で追わない工程にする|日報で追う工程/ })).toBeNull()
  })
})
