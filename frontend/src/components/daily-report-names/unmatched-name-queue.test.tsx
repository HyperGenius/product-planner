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

/** 確認ダイアログで登録を確定する */
async function confirmDialog(button: string) {
  const dialog = await screen.findByRole("alertdialog")
  await userEvent.click(within(dialog).getByRole("button", { name: button }))
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
    expect(posts).toEqual([])
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("組立機B")).toBeInTheDocument()
    expect(within(dialog).getByText("組立")).toBeInTheDocument()
    expect(within(dialog).getByText(/過去・今後の日報にも自動で反映されます/)).toBeInTheDocument()
    await confirmDialog("登録する")

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
    expect(posts).toEqual([])
    await confirmDialog("登録する")

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
    expect(posts).toEqual([])
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("ピン φ6×20")).toBeInTheDocument()
    expect(within(dialog).getByText("類似度 82%")).toBeInTheDocument()
    expect(within(dialog).getByText(/顧客先: 顧客A/)).toBeInTheDocument()
    await confirmDialog("登録する")
    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: "/daily-reports/name-aliases/product",
        body: { raw_text: "ピン6x20", customer_id: 10, product_id: 100 },
      }),
    )
  })

  it("別名を登録しても、他の行の類似候補は再検索しない（PR #498 レビュー）", async () => {
    const posts = mockQueue([
      unmatched({ kind: "product", raw_text: "ピンA", customer_raw: "顧客A", customer_id: 10 }),
      unmatched({ kind: "product", raw_text: "ピンB", customer_raw: "顧客A", customer_id: 10 }),
    ])
    const candidateRequests: string[] = []
    server.use(
      http.get(`${API_BASE}/daily-reports/product-candidates`, ({ request }) => {
        const rawText = new URL(request.url).searchParams.get("raw_text")!
        candidateRequests.push(rawText)
        return HttpResponse.json([{ product_id: 100, name: `${rawText} 製品`, score: 0.8 }])
      }),
    )

    render(<UnmatchedNameQueue canEdit />)
    await openTab(/製品/)
    await userEvent.click(
      await screen.findByRole("button", { name: "「ピンA」を「ピンA 製品」に対応付ける" }),
    )

    await confirmDialog("登録する")
    await waitFor(() => expect(posts).toHaveLength(1))
    // 登録後に未照合一覧は取り直す（ピンA が消える）が、候補の検索は行ごとに1回のまま
    await waitFor(() => expect(screen.queryByText("ピンA")).not.toBeInTheDocument())
    expect(screen.getByText("ピンB")).toBeInTheDocument()
    expect(candidateRequests.sort()).toEqual(["ピンA", "ピンB"])
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
    expect(posts).toEqual([])
    expect(await screen.findByText(/元に戻すには「対象外」タブから解除します/)).toBeInTheDocument()
    await confirmDialog("対象外にする")

    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: "/daily-reports/ignored-names",
        body: { kind: "product", raw_text: "試作品", customer_raw: null },
      }),
    )
    expect(await screen.findByText("未照合の製品はありません")).toBeInTheDocument()
  })

  it("キャンセルすると何も登録せず、行も残る", async () => {
    const posts = mockQueue([unmatched({ raw_text: "組立機B" })])

    render(<UnmatchedNameQueue canEdit />)
    await openPicker("「組立機B」の設備を選択")
    await userEvent.click(await screen.findByRole("option", { name: /組立.*台帳No\.12/ }))
    await confirmDialog("キャンセル")

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(posts).toEqual([])
    expect(screen.getByRole("button", { name: "組立機B" })).toBeInTheDocument()
  })

  it("「対象外」もキャンセルすると登録しない", async () => {
    const posts = mockQueue([unmatched({ raw_text: "試作機" })])

    render(<UnmatchedNameQueue canEdit />)
    await userEvent.click(await screen.findByRole("button", { name: "「試作機」を対象外にする" }))
    await confirmDialog("キャンセル")

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(posts).toEqual([])
  })

  it("登録に失敗したらダイアログを開いたままにする", async () => {
    mockQueue([unmatched({ raw_text: "組立機B" })])
    server.use(
      http.post(`${API_BASE}/daily-reports/name-aliases/equipment`, () =>
        HttpResponse.json({ detail: "error" }, { status: 500 }),
      ),
    )

    render(<UnmatchedNameQueue canEdit />)
    await openPicker("「組立機B」の設備を選択")
    await userEvent.click(await screen.findByRole("option", { name: /組立.*台帳No\.12/ }))
    await confirmDialog("登録する")

    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument())
    // 失敗後は再度押せる（実行中のままにならない）
    await waitFor(() =>
      expect(within(screen.getByRole("alertdialog")).getByRole("button", { name: "登録する" })).toBeEnabled(),
    )
  })

  describe("製品の受注状況 (Issue #646)", () => {
    const ORDERS = [
      {
        order_id: 1,
        order_number: "A-001",
        customer_order_no: null,
        product_id: 100,
        product_name: "ピン φ6×20",
        quantity: 500,
        desired_deadline: "2026-12-05",
        status: "confirmed",
        allocatable: true,
      },
      {
        order_id: 2,
        order_number: null,
        customer_order_no: "PO-9",
        product_id: 101,
        product_name: "ピン φ6×25",
        quantity: 20,
        desired_deadline: null,
        status: "draft",
        allocatable: false,
      },
    ]
    const PRODUCT_ROW = unmatched({
      kind: "product",
      raw_text: "ピン6x20",
      customer_raw: "顧客A",
      customer_id: 10,
    })

    function mockOrderApis() {
      let candidateCustomerId: string | null = null
      server.use(
        http.get(`${API_BASE}/daily-reports/product-candidates`, ({ request }) => {
          candidateCustomerId = new URL(request.url).searchParams.get("customer_id")
          return HttpResponse.json([
            {
              product_id: 100,
              name: "ピン φ6×20",
              score: 0.82,
              open_order_count: 2,
              nearest_deadline: "2026-12-05",
            },
            { product_id: 101, name: "ピン φ6×25", score: 0.6, open_order_count: 0 },
          ])
        }),
        http.get(`${API_BASE}/daily-reports/customer-open-orders`, () =>
          HttpResponse.json(ORDERS),
        ),
      )
      return () => candidateCustomerId
    }

    it("候補に受注の有無を出し、受注なしでも選べる", async () => {
      mockQueue([PRODUCT_ROW])
      const customerId = mockOrderApis()

      render(<UnmatchedNameQueue canEdit />)
      await openTab(/製品/)

      const withOrders = await screen.findByRole("button", {
        name: "「ピン6x20」を「ピン φ6×20」に対応付ける",
      })
      const withoutOrders = screen.getByRole("button", {
        name: "「ピン6x20」を「ピン φ6×25」に対応付ける",
      })
      expect(customerId()).toBe("10")
      expect(within(withOrders).getByText("受注あり 2件")).toBeInTheDocument()
      expect(withOrders).toHaveAttribute("title", expect.stringContaining("2026/12/05"))
      expect(within(withoutOrders).getByText("受注なし")).toBeInTheDocument()
      expect(withoutOrders).toBeEnabled()
    })

    it("確認ダイアログに割り付け先の受注を出す", async () => {
      mockQueue([PRODUCT_ROW])
      mockOrderApis()

      render(<UnmatchedNameQueue canEdit />)
      await openTab(/製品/)
      await userEvent.click(
        await screen.findByRole("button", { name: "「ピン6x20」を「ピン φ6×20」に対応付ける" }),
      )

      const dialog = await screen.findByRole("alertdialog")
      expect(await within(dialog).findByText("A-001")).toBeInTheDocument()
      expect(within(dialog).getByText("500")).toBeInTheDocument()
      expect(within(dialog).getByText("2026/12/05")).toBeInTheDocument()
      expect(within(dialog).getByText("確定")).toBeInTheDocument()
      // 別の製品の受注や割り付け対象外の受注は出さない
      expect(within(dialog).queryByText("PO-9")).not.toBeInTheDocument()
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
    })

    it("割り付け先が無い製品は警告するが、登録はできる", async () => {
      const posts = mockQueue([PRODUCT_ROW])
      mockOrderApis()

      render(<UnmatchedNameQueue canEdit />)
      await openTab(/製品/)
      // 製品101 の受注は下書きのみ（割り付け対象外）
      await userEvent.click(
        await screen.findByRole("button", { name: "「ピン6x20」を「ピン φ6×25」に対応付ける" }),
      )

      const dialog = await screen.findByRole("alertdialog")
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "割り付け先がないため、実績は未割当に残ります",
      )
      await confirmDialog("登録する")
      await waitFor(() => expect(posts).toHaveLength(1))
      expect(posts[0].body).toEqual({ raw_text: "ピン6x20", customer_id: 10, product_id: 101 })
    })

    it("受注の取得に失敗したら警告は出さず、登録は続けられる", async () => {
      mockQueue([PRODUCT_ROW])
      mockOrderApis()
      server.use(
        http.get(`${API_BASE}/daily-reports/customer-open-orders`, () =>
          HttpResponse.json({ detail: "error" }, { status: 500 }),
        ),
      )

      render(<UnmatchedNameQueue canEdit />)
      await openTab(/製品/)
      await userEvent.click(
        await screen.findByRole("button", { name: "「ピン6x20」を「ピン φ6×20」に対応付ける" }),
      )

      const dialog = await screen.findByRole("alertdialog")
      expect(await within(dialog).findByText("受注の状況を取得できませんでした")).toBeInTheDocument()
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
      expect(within(dialog).getByRole("button", { name: "登録する" })).toBeEnabled()
    })

    it("行の展開部に顧客の未出荷の受注を一覧で出す", async () => {
      mockQueue([PRODUCT_ROW])
      mockOrderApis()
      server.use(
        http.get(`${API_BASE}/daily-reports/name-entries`, () => HttpResponse.json([])),
      )

      render(<UnmatchedNameQueue canEdit />)
      await openTab(/製品/)
      await userEvent.click(await screen.findByRole("button", { name: "ピン6x20" }))

      expect(await screen.findByText("この顧客の未出荷の受注（2 件）")).toBeInTheDocument()
      expect(screen.getByText("A-001")).toBeInTheDocument()
      // 注文番号が無い受注は顧客の注文番号を出し、割り付け対象外は印を付ける
      expect(screen.getByText("PO-9")).toBeInTheDocument()
      expect(screen.getByText("割り付け対象外")).toBeInTheDocument()
    })

    it("顧客先が未照合の行の展開部では受注を取得しない", async () => {
      mockQueue([{ ...PRODUCT_ROW, customer_id: null, customer_raw: "未登録の顧客" }])
      let requested = false
      server.use(
        http.get(`${API_BASE}/daily-reports/name-entries`, () => HttpResponse.json([])),
        http.get(`${API_BASE}/daily-reports/customer-open-orders`, () => {
          requested = true
          return HttpResponse.json([])
        }),
      )

      render(<UnmatchedNameQueue canEdit />)
      await openTab(/製品/)
      await userEvent.click(await screen.findByRole("button", { name: "ピン6x20" }))

      await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument())
      expect(screen.queryByText(/この顧客の未出荷の受注/)).not.toBeInTheDocument()
      expect(requested).toBe(false)
    })
  })

  it("編集できないロールには操作を出さない", async () => {
    mockQueue([unmatched({ raw_text: "組立機B" })])

    render(<UnmatchedNameQueue canEdit={false} />)

    expect(await screen.findByRole("button", { name: "組立機B" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /対象外にする/ })).not.toBeInTheDocument()
  })
})
