import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { UnmatchedName } from "@/types/daily-report-names"
import { UnmatchedNameQueue } from "./unmatched-name-queue"

/**
 * 未照合キュー (Issue #489)。表記はダミー値（実データを含めない）。
 */

function unmatched(overrides: Partial<UnmatchedName>): UnmatchedName {
  return {
    kind: "equipment",
    raw_text: "組立機B",
    customer_raw: null,
    customer_id: null,
    entry_count: 1,
    last_work_date: "2026-09-01",
    ...overrides,
  }
}

/** 未照合一覧を返し、別名・対象外が POST されたらその表記の行を消す（照合済み・対象外になった想定） */
function mockQueue(initial: UnmatchedName[]) {
  let items = initial
  const posts: { path: string; body: unknown }[] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/unmatched-names`, () => HttpResponse.json(items)),
    http.get(`${API_BASE}/equipments`, () =>
      HttpResponse.json([
        { id: 7, name: "フィルター自動組立機", short_name: "組立", ledger_no: 12 },
        { id: 8, name: "200tプレス", short_name: null, ledger_no: 3 },
      ]),
    ),
    http.get(`${API_BASE}/daily-reports/process-names`, () =>
      HttpResponse.json(["カシメ", "クグシ", "検査"]),
    ),
    http.post(`${API_BASE}/daily-reports/*`, async ({ request }) => {
      const body = (await request.json()) as { raw_text: string }
      posts.push({ path: new URL(request.url).pathname, body })
      items = items.filter((i) => i.raw_text !== body.raw_text)
      return HttpResponse.json({}, { status: 201 })
    }),
  )
  return posts
}

/** 対応付け先のコンボボックスを開く（マスタの読み込み中は無効なので有効になるのを待つ） */
async function openPicker(name: string) {
  const trigger = await screen.findByRole("combobox", { name })
  await waitFor(() => expect(trigger).toBeEnabled())
  await userEvent.click(trigger)
}

async function openTab(name: RegExp) {
  await userEvent.click(await screen.findByRole("tab", { name }))
}

describe("UnmatchedNameQueue", () => {
  it("種別ごとの件数をタブに出し、出現件数順に並べる", async () => {
    mockQueue([
      unmatched({ raw_text: "組立機B", entry_count: 30 }),
      unmatched({ raw_text: "試作機", entry_count: 2 }),
      unmatched({ kind: "process", raw_text: "カシメ加工", entry_count: 10 }),
    ])

    render(<UnmatchedNameQueue canEdit />)

    expect(await screen.findByRole("tab", { name: /設備\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /工程\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /製品\s*0/ })).toBeInTheDocument()
    const names = screen
      .getAllByRole("button", { expanded: false })
      .map((b) => b.textContent)
    expect(names).toEqual(["組立機B", "試作機"])
    expect(screen.getByText("30 件")).toBeInTheDocument()
  })

  it("表記をクリックすると、その表記が使われている日報の行を表示する", async () => {
    mockQueue([unmatched({ raw_text: "組立機B", entry_count: 2 })])
    server.use(
      http.get(`${API_BASE}/daily-reports/name-entries`, () =>
        HttpResponse.json([
          {
            id: 1,
            sheet_name: "2609製造",
            row_no: 3,
            work_date: "2026-09-02",
            customer_raw: "顧客A",
            product_raw: "ピンA",
            process_raw: "カシメ加工",
            equipment_raw: "組立機B",
            worker_raw: null,
            processed_qty: 1200,
            defect_qty: 0,
            good_qty: 1200,
          },
        ]),
      ),
    )

    render(<UnmatchedNameQueue canEdit />)
    await userEvent.click(await screen.findByRole("button", { name: "組立機B" }))

    const table = await screen.findByRole("table")
    expect(within(table).getByText("2026/09/02")).toBeInTheDocument()
    expect(within(table).getByText("ピンA")).toBeInTheDocument()
    expect(within(table).getAllByText("1,200")).toHaveLength(2)
    expect(screen.getByText(/新しい順に 1 件を表示しています（全 2 件）/)).toBeInTheDocument()
  })

  it("設備を選ぶと別名を登録し、キューから消える", async () => {
    const posts = mockQueue([unmatched({ raw_text: "組立機B" })])

    render(<UnmatchedNameQueue canEdit />)
    await openPicker("「組立機B」の設備を選択")
    await userEvent.click(await screen.findByRole("option", { name: /組立.*台帳No\.12/ }))

    await waitFor(() =>
      expect(posts).toEqual([
        {
          path: "/daily-reports/name-aliases/equipment",
          body: { raw_text: "組立機B", equipment_id: 7 },
        },
      ]),
    )
    expect(await screen.findByText("未照合の設備はありません")).toBeInTheDocument()
  })

  it("工程は複数選択して登録できる（1:N）", async () => {
    const posts = mockQueue([unmatched({ kind: "process", raw_text: "カシメ、仕上げ加工" })])

    render(<UnmatchedNameQueue canEdit />)
    await openTab(/工程/)
    await openPicker("「カシメ、仕上げ加工」の工程を選択")
    await userEvent.click(await screen.findByRole("option", { name: "カシメ" }))
    await userEvent.click(screen.getByRole("option", { name: "クグシ" }))
    await userEvent.click(screen.getByRole("button", { name: "決定" }))

    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: "/daily-reports/name-aliases/process",
        body: { raw_text: "カシメ、仕上げ加工", process_names: ["カシメ", "クグシ"] },
      }),
    )
  })

  it("製品は類似候補を選ぶだけで、顧客単位の別名として登録できる", async () => {
    const posts = mockQueue([
      unmatched({
        kind: "product",
        raw_text: "ピン6x20",
        customer_raw: "顧客A",
        customer_id: 10,
      }),
    ])
    let candidateQuery: string | null = null
    server.use(
      http.get(`${API_BASE}/daily-reports/product-candidates`, ({ request }) => {
        candidateQuery = new URL(request.url).searchParams.get("raw_text")
        return HttpResponse.json([
          { product_id: 100, name: "ピン φ6×20", score: 0.82 },
          { product_id: 101, name: "ピン φ6×25", score: 0.6 },
        ])
      }),
    )

    render(<UnmatchedNameQueue canEdit />)
    await openTab(/製品/)
    await userEvent.click(
      await screen.findByRole("button", { name: "「ピン6x20」を「ピン φ6×20」に対応付ける" }),
    )

    expect(candidateQuery).toBe("ピン6x20")
    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: "/daily-reports/name-aliases/product",
        body: { raw_text: "ピン6x20", customer_id: 10, product_id: 100 },
      }),
    )
  })

  it("顧客先が未照合の製品は、候補を出さずに先に顧客の対応付けを促す", async () => {
    let candidateRequested = false
    mockQueue([
      unmatched({
        kind: "product",
        raw_text: "ピン6x20",
        customer_raw: "未登録の顧客",
        customer_id: null,
      }),
    ])
    server.use(
      http.get(`${API_BASE}/daily-reports/product-candidates`, () => {
        candidateRequested = true
        return HttpResponse.json([])
      }),
    )

    render(<UnmatchedNameQueue canEdit />)
    await openTab(/製品/)

    expect(
      await screen.findByText("顧客先「未登録の顧客」を先に「顧客」で対応付けてください"),
    ).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(candidateRequested).toBe(false)
  })

  it("「対象外」にした表記はキューから消える", async () => {
    const posts = mockQueue([
      unmatched({ kind: "product", raw_text: "試作品", customer_raw: null, customer_id: null }),
    ])

    render(<UnmatchedNameQueue canEdit />)
    await openTab(/製品/)
    await userEvent.click(await screen.findByRole("button", { name: "「試作品」を対象外にする" }))

    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: "/daily-reports/ignored-names",
        body: { kind: "product", raw_text: "試作品", customer_raw: null },
      }),
    )
    expect(await screen.findByText("未照合の製品はありません")).toBeInTheDocument()
  })

  it("編集できないロールには操作を出さない", async () => {
    mockQueue([unmatched({ raw_text: "組立機B" })])

    render(<UnmatchedNameQueue canEdit={false} />)

    expect(await screen.findByRole("button", { name: "組立機B" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /対象外にする/ })).not.toBeInTheDocument()
  })
})
