import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Equipment } from "@/types/equipment"
import { EquipmentDetailSheet } from "./equipment-detail-sheet"

/** 設備の詳細シート（Issue #503）。値はダミー */

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const equipment: Equipment = {
  id: 7,
  name: "25Tシングルクランクプレス",
  short_name: "プレス25t",
  ledger_no: 1,
  maker: "メーカーA",
  model: "M-25",
  manufactured_on: "1993年5月",
  serial_no: "S-001",
  note: null,
  guard_time_minutes: 30,
  min_slot_minutes: null,
  max_fragments: null,
  tenant_id: "tenant-1",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
}

function mockApi(write?: () => Response) {
  const requests: { method: string; path: string; body: unknown }[] = []
  const record = async ({ request }: { request: Request }) => {
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: request.method === "DELETE" ? null : await request.json(),
    })
    return write ? write() : HttpResponse.json({ ...equipment, id: 99 })
  }
  server.use(
    http.get(`${API_BASE}/equipment-groups`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/equipment-groups/members`, () => HttpResponse.json([])),
    http.get(`${API_BASE}/equipments`, () => HttpResponse.json([equipment])),
    http.post(`${API_BASE}/equipments`, record),
    http.patch(`${API_BASE}/equipments/:id`, record),
    http.delete(`${API_BASE}/equipments/:id`, record),
  )
  return requests
}

function renderSheet(props: Partial<Parameters<typeof EquipmentDetailSheet>[0]> = {}) {
  const onOpenChange = vi.fn()
  const onCreated = vi.fn()
  render(
    <EquipmentDetailSheet
      open
      onOpenChange={onOpenChange}
      equipment={equipment}
      groupNames={["プレス"]}
      onCreated={onCreated}
      {...props}
    />,
  )
  return { onOpenChange, onCreated }
}

describe("EquipmentDetailSheet", () => {
  it("台帳の全項目・所属グループ・スケジューリング設定を表示する", async () => {
    mockApi()
    renderSheet()

    const sheet = await screen.findByRole("dialog")
    expect(within(sheet).getByRole("heading", { name: "プレス25t" })).toBeInTheDocument()
    for (const text of ["メーカーA", "M-25", "1993年5月", "S-001", "プレス", "30分"]) {
      expect(within(sheet).getByText(text)).toBeInTheDocument()
    }
    expect(within(sheet).getAllByText("25Tシングルクランクプレス").length).toBeGreaterThan(0)
    // 未設定のスケジューリング設定はグローバル設定を使う
    expect(within(sheet).getAllByText("グローバル設定を使用")).toHaveLength(2)
  })

  it("シートの中で編集して保存すると、閲覧モードに戻る", async () => {
    const requests = mockApi()
    renderSheet()

    await userEvent.click(await screen.findByRole("button", { name: "編集" }))
    const shortName = screen.getByLabelText("呼称")
    expect(shortName).toHaveValue("プレス25t")
    await userEvent.clear(shortName)
    await userEvent.type(shortName, "ワシノ25t")
    await userEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      path: "/equipments/7",
      body: { name: "25Tシングルクランクプレス", short_name: "ワシノ25t", ledger_no: 1, guard_time_minutes: 30 },
    })
    expect(await screen.findByRole("button", { name: "編集" })).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith("設備を更新しました")
  })

  it("編集をキャンセルすると保存せずに閲覧モードに戻る", async () => {
    const requests = mockApi()
    renderSheet()

    await userEvent.click(await screen.findByRole("button", { name: "編集" }))
    await userEvent.click(screen.getByRole("button", { name: "キャンセル" }))

    expect(await screen.findByRole("button", { name: "編集" })).toBeInTheDocument()
    expect(requests).toHaveLength(0)
  })

  it("表示名の重複（409）はメッセージを出し、編集モードのまま残る", async () => {
    mockApi(() => HttpResponse.json({ detail: { error: "duplicate_display_name" } }, { status: 409 }))
    renderSheet()

    await userEvent.click(await screen.findByRole("button", { name: "編集" }))
    await userEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("呼称を入力して区別")),
    )
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument()
  })

  it("設備が無ければ新規作成モードで開き、作成した設備の ID を返す", async () => {
    const requests = mockApi()
    const { onCreated } = renderSheet({ equipment: null, groupNames: [] })

    expect(await screen.findByRole("heading", { name: "設備の新規作成" })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("設備名（正式名称）"), "15Tプレス")
    await userEvent.click(screen.getByRole("button", { name: "作成" }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(99))
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/equipments",
      body: { name: "15Tプレス", short_name: null, ledger_no: null },
    })
  })

  it("削除は確認してから実行し、シートを閉じる", async () => {
    const requests = mockApi()
    const { onOpenChange } = renderSheet()

    await userEvent.click(await screen.findByRole("button", { name: "削除" }))
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText(/「プレス25t」を削除しますか/)).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole("button", { name: "削除" }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(requests).toEqual([{ method: "DELETE", path: "/equipments/7", body: null }])
  })
})
