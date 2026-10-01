import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE, sampleCustomers, sampleProducts } from "@/test-utils/msw/handlers"
import { NameAliasList } from "./name-alias-list"

/** 登録済みの対応付けの一覧・変更・削除 (Issue #489)。値はダミー */

const ALIAS_META = {
  created_by: "u-1",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
}

function mockAliases() {
  const requests: { method: string; path: string; body: unknown }[] = []
  const record = async ({ request }: { request: Request }) => {
    requests.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: request.method === "DELETE" ? null : await request.json(),
    })
    return HttpResponse.json({})
  }
  server.use(
    http.get(`${API_BASE}/equipments`, () =>
      HttpResponse.json([
        { id: 7, name: "フィルター自動組立機", short_name: "組立", ledger_no: 12 },
        { id: 8, name: "200tプレス", short_name: null, ledger_no: 3 },
      ]),
    ),
    http.get(`${API_BASE}/daily-reports/name-aliases/equipment`, () =>
      HttpResponse.json([{ id: "e-1", raw_text: "組立機B", equipment_id: 7, ...ALIAS_META }]),
    ),
    http.get(`${API_BASE}/daily-reports/name-aliases/process`, () =>
      HttpResponse.json([
        {
          id: "p-1",
          raw_text: "カシメ、仕上げ加工",
          process_names: ["カシメ", "クグシ"],
          ...ALIAS_META,
        },
      ]),
    ),
    http.get(`${API_BASE}/daily-reports/process-names`, () =>
      HttpResponse.json(["カシメ", "クグシ"]),
    ),
    http.get(`${API_BASE}/daily-reports/name-aliases/product`, () =>
      HttpResponse.json([
        {
          id: "a-1",
          customer_id: sampleCustomers[0].id,
          raw_text: "短いピン",
          product_id: sampleProducts[1].id,
          source: "daily_report",
          created_at: ALIAS_META.created_at,
          updated_at: ALIAS_META.updated_at,
        },
      ]),
    ),
    http.patch(`${API_BASE}/*`, record),
    http.delete(`${API_BASE}/*`, record),
  )
  return requests
}

async function openPicker(name: string) {
  const trigger = await screen.findByRole("combobox", { name })
  await waitFor(() => expect(trigger).toBeEnabled())
  await userEvent.click(trigger)
}

describe("NameAliasList", () => {
  it("設備の対応付けを表示名（呼称）で一覧し、変更できる", async () => {
    const requests = mockAliases()

    render(<NameAliasList canEdit />)

    const row = (await screen.findByText("組立機B")).closest("li")!
    await waitFor(() => expect(within(row).getByText("組立")).toBeInTheDocument())

    await openPicker("「組立機B」の設備を変更")
    await userEvent.click(await screen.findByRole("option", { name: /200tプレス/ }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          method: "PATCH",
          path: "/daily-reports/name-aliases/equipment/e-1",
          body: { equipment_id: 8 },
        },
      ]),
    )
  })

  it("削除は確認してから行う", async () => {
    const requests = mockAliases()

    render(<NameAliasList canEdit />)
    await userEvent.click(
      await screen.findByRole("button", { name: "「組立機B」の対応付けを削除" }),
    )
    expect(requests).toEqual([])

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/未照合キューに戻ります/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole("button", { name: "削除" }))

    await waitFor(() =>
      expect(requests).toEqual([
        { method: "DELETE", path: "/daily-reports/name-aliases/equipment/e-1", body: null },
      ]),
    )
  })

  it("工程は対応先の工程名をすべて表示する（1:N）", async () => {
    mockAliases()

    render(<NameAliasList canEdit />)
    await userEvent.click(await screen.findByRole("tab", { name: "工程" }))

    expect(await screen.findByText("カシメ・クグシ")).toBeInTheDocument()
  })

  it("製品の別名は製品マスタの別名 API で付け替える", async () => {
    const requests = mockAliases()

    render(<NameAliasList canEdit />)
    await userEvent.click(await screen.findByRole("tab", { name: "製品" }))

    const row = (await screen.findByText("短いピン")).closest("li")!
    await waitFor(() =>
      expect(within(row).getByText(`顧客: ${sampleCustomers[0].name}`)).toBeInTheDocument(),
    )
    expect(within(row).getByText("日報")).toBeInTheDocument()

    await openPicker("「短いピン」の製品を変更")
    await userEvent.click(await screen.findByRole("option", { name: /テスト製品A/ }))

    await waitFor(() =>
      expect(requests).toEqual([
        {
          method: "PATCH",
          path: `/products/${sampleProducts[1].id}/aliases/a-1`,
          body: { product_id: sampleProducts[0].id },
        },
      ]),
    )
  })

  it("表記で絞り込める", async () => {
    mockAliases()

    render(<NameAliasList canEdit />)
    await screen.findByText("組立機B")
    await userEvent.type(screen.getByRole("textbox", { name: "表記で絞り込み" }), "プレス")

    expect(await screen.findByText("登録済みの対応付けはありません")).toBeInTheDocument()
  })

  it("編集できないロールには変更・削除を出さない", async () => {
    mockAliases()

    render(<NameAliasList canEdit={false} />)

    expect(await screen.findByText("組立機B")).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /削除/ })).not.toBeInTheDocument()
  })
})
