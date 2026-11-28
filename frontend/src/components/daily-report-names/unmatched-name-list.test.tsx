import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { useUnmatchedNames } from "@/hooks/use-daily-report-names"
import {
  NAME_KIND_LABELS,
  type NameKind,
  type OrderedProductCandidate,
  type UnmatchedName,
} from "@/types/daily-report-names"
import type { SimilarProduct } from "@/types/product"
import { DAILY_REPORT_FORBIDDEN_UI_TEXT } from "@/test-utils/daily-report"
import { UnmatchedNameList } from "./unmatched-name-list"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

/**
 * 日報の表記の一覧 (Issue #489 / #707)。表記はダミー値（実データを含めない）。
 */

/** ページと同じく、表記の一覧を取得して1つの種別の行を並べる（ページごとの振り分けは daily-report-worklist-utils のテスト） */
function Queue({ kind = "equipment", canEdit = false }: { kind?: NameKind; canEdit?: boolean }) {
  const { data } = useUnmatchedNames()
  if (!data) return null
  return (
    <UnmatchedNameList
      items={data.filter((i) => i.kind === kind)}
      kind={kind}
      canEdit={canEdit}
      emptyMessage={`結び付ける${NAME_KIND_LABELS[kind]}はありません`}
    />
  )
}

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

function orderedProduct(overrides: Partial<OrderedProductCandidate>): OrderedProductCandidate {
  return {
    product_id: 100,
    name: "ピン φ6×20",
    code: null,
    order_count: 1,
    nearest_deadline: "2026-12-05",
    order_number: "A-001",
    customer_order_no: null,
    quantity: 100,
    ...overrides,
  }
}

/** 対象外の取り消し（DELETE）を受けた ID。`mockQueue()` のたびに空にする */
let ignoredDeletes: string[] = []

/** 表記の一覧を返し、別名・対象外が POST されたらその表記の行を消す（結び付いた・対象外になった想定） */
function mockQueue(initial: UnmatchedName[]) {
  let items = initial
  const posts: { path: string; body: unknown }[] = []
  ignoredDeletes = []
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
      return HttpResponse.json({ id: "ignored-1", ...body }, { status: 201 })
    }),
    http.delete(`${API_BASE}/daily-reports/ignored-names/:id`, ({ params }) => {
      ignoredDeletes.push(String(params.id))
      return HttpResponse.json({})
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

describe("UnmatchedNameList", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it("明細の多い順に並べ、件数に単位を付ける", async () => {
    mockQueue([
      unmatched({ raw_text: "組立機B", entry_count: 30 }),
      unmatched({ raw_text: "試作機", entry_count: 2 }),
      unmatched({ kind: "process", raw_text: "カシメ加工", entry_count: 10 }),
    ])

    render(<Queue canEdit />)

    await screen.findByRole("button", { name: "組立機B" })
    const names = screen
      .getAllByRole("button", { expanded: false })
      .map((b) => b.textContent)
    expect(names).toEqual(["組立機B", "試作機"])
    expect(screen.getByText("30明細")).toBeInTheDocument()
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

    render(<Queue canEdit />)
    await userEvent.click(await screen.findByRole("button", { name: "組立機B" }))

    const table = await screen.findByRole("table")
    expect(within(table).getByText("2026/09/02")).toBeInTheDocument()
    expect(within(table).getByText("ピンA")).toBeInTheDocument()
    expect(within(table).getAllByText("1,200")).toHaveLength(2)
    expect(screen.getByText("全2明細のうち新しい1明細")).toBeInTheDocument()
  })

  it("設備を選ぶと別名を登録し、キューから消える", async () => {
    const posts = mockQueue([unmatched({ raw_text: "組立機B" })])

    render(<Queue canEdit />)
    await openPicker("「組立機B」の設備を選択")
    await userEvent.click(await screen.findByRole("option", { name: /組立.*台帳No\.12/ }))
    expect(posts).toEqual([])
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("組立機B")).toBeInTheDocument()
    expect(within(dialog).getByText("組立")).toBeInTheDocument()
    // 反映のタイミングはヘルプに置き、ダイアログには書かない（Issue #702）
    expect(dialog.textContent).not.toMatch(/反映|集計/)
    await confirmDialog("登録する")

    await waitFor(() =>
      expect(posts).toEqual([
        {
          path: "/daily-reports/name-aliases/equipment",
          body: { raw_text: "組立機B", equipment_id: 7 },
        },
      ]),
    )
    expect(await screen.findByText("結び付ける設備はありません")).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith("「組立機B」を対応付けました")
  })

  it("工程は複数選択して登録できる（1:N）", async () => {
    const posts = mockQueue([unmatched({ kind: "process", raw_text: "カシメ、仕上げ加工" })])

    render(<Queue kind="process" canEdit />)
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

  it("製品は受注の製品を選ぶだけで、顧客単位の別名として登録できる（Issue #704）", async () => {
    const posts = mockQueue([
      unmatched({
        kind: "product",
        raw_text: "ピン6x20",
        customer_raw: "顧客A",
        customer_id: 10,
      }),
    ])
    let orderedQuery: string | null = null
    server.use(
      http.get(`${API_BASE}/daily-reports/customer-ordered-products`, ({ request }) => {
        orderedQuery = new URL(request.url).searchParams.get("customer_id")
        return HttpResponse.json([orderedProduct({ product_id: 100, name: "ピン φ6×20" })])
      }),
    )

    render(<Queue kind="product" canEdit />)
    await userEvent.click(
      await screen.findByRole("button", { name: "「ピン6x20」を「ピン φ6×20」に対応付ける" }),
    )

    expect(orderedQuery).toBe("10")
    expect(posts).toEqual([])
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("ピン φ6×20")).toBeInTheDocument()
    expect(within(dialog).getByText(/顧客先: 顧客A/)).toBeInTheDocument()
    // 類似度の数値は判断材料にならないので出さない（Issue #702）
    expect(document.body.textContent).not.toMatch(/類似度/)
    await confirmDialog("登録する")
    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: "/daily-reports/name-aliases/product",
        body: { raw_text: "ピン6x20", customer_id: 10, product_id: 100 },
      }),
    )
  })

  it("受注の製品は日報の品名に近い順に3件まで行に並べ、残りは「受注の製品」から選べる", async () => {
    mockQueue([
      unmatched({ kind: "product", raw_text: "シャフト S-12", customer_raw: "顧客A", customer_id: 10 }),
    ])
    server.use(
      // API は希望納期の近い順。行では品名（品番）の近い順に並べ直す
      http.get(`${API_BASE}/daily-reports/customer-ordered-products`, () =>
        HttpResponse.json([
          orderedProduct({ product_id: 1, name: "ピン φ6×20", nearest_deadline: "2026-12-01" }),
          orderedProduct({ product_id: 2, name: "カラー", code: "C-3", order_number: "A-002" }),
          orderedProduct({ product_id: 3, name: "シャフト", code: "S-12", order_number: "A-003" }),
          orderedProduct({ product_id: 4, name: "シャフト 長", order_number: "A-004" }),
        ]),
      ),
    )

    render(<Queue kind="product" canEdit />)

    const inline = await screen.findAllByRole("button", { name: /^「シャフト S-12」を「.+」に対応付ける$/ })
    expect(inline.map((b) => b.getAttribute("aria-label"))).toEqual([
      "「シャフト S-12」を「シャフト」に対応付ける",
      "「シャフト S-12」を「シャフト 長」に対応付ける",
      "「シャフト S-12」を「ピン φ6×20」に対応付ける",
    ])
    // 受注の情報を添える。全製品の似ている製品・受注の有無のバッジは行に出さない
    expect(within(inline[0]).getByText("A-003・数量 100・希望納期 2026/12/05")).toBeInTheDocument()
    expect(screen.queryByText(/受注あり|受注なし/)).not.toBeInTheDocument()

    await openPicker("「シャフト S-12」の製品を選択")
    const group = await screen.findByRole("group", { name: "受注の製品" })
    expect(within(group).getAllByRole("option")).toHaveLength(1)
    expect(within(group).getByRole("option", { name: /カラー/ })).toHaveTextContent("A-002")
  })

  it("受注の製品が無い顧客の行には候補を出さず、他の製品から選べる", async () => {
    mockQueue([
      unmatched({ kind: "product", raw_text: "ピン6x20", customer_raw: "顧客A", customer_id: 10 }),
    ])

    render(<Queue kind="product" canEdit />)

    expect(await screen.findByRole("combobox", { name: "「ピン6x20」の製品を選択" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /に対応付ける$/ })).not.toBeInTheDocument()
  })

  it("似ている製品（全製品）は「他の製品から選択」を開いたときだけ検索し、受注の有無を添える", async () => {
    const posts = mockQueue([
      unmatched({ kind: "product", raw_text: "ピン6x20", customer_raw: "顧客A", customer_id: 10 }),
    ])
    const candidateRequests: (string | null)[] = []
    server.use(
      http.get(`${API_BASE}/daily-reports/product-candidates`, ({ request }) => {
        candidateRequests.push(new URL(request.url).searchParams.get("customer_id"))
        return HttpResponse.json([
          { product_id: 100, name: "ピン φ6×20", score: 0.82, open_order_count: 2 },
          { product_id: 101, name: "ピン φ6×25", score: 0.6, open_order_count: 0 },
        ])
      }),
    )

    render(<Queue kind="product" canEdit />)
    await screen.findByRole("combobox", { name: "「ピン6x20」の製品を選択" })
    expect(candidateRequests).toEqual([])

    await openPicker("「ピン6x20」の製品を選択")
    const group = await screen.findByRole("group", { name: "似ている製品" })
    expect(await within(group).findByRole("option", { name: /ピン φ6×20/ })).toHaveTextContent(
      "受注あり 2注文",
    )
    expect(within(group).getByRole("option", { name: /ピン φ6×25/ })).toHaveTextContent("受注なし")
    expect(candidateRequests).toEqual(["10"])

    await userEvent.click(within(group).getByRole("option", { name: /ピン φ6×25/ }))
    await confirmDialog("登録する")
    await waitFor(() =>
      expect(posts[0].body).toEqual({ raw_text: "ピン6x20", customer_id: 10, product_id: 101 }),
    )
  })

  it("別名を登録しても、受注の製品は取り直さず、顧客単位で1回だけ取得する（PR #498 レビュー）", async () => {
    const posts = mockQueue([
      unmatched({ kind: "product", raw_text: "ピンA", customer_raw: "顧客A", customer_id: 10 }),
      unmatched({ kind: "product", raw_text: "ピンB", customer_raw: "顧客A", customer_id: 10 }),
    ])
    const orderedRequests: string[] = []
    let candidateRequested = false
    server.use(
      http.get(`${API_BASE}/daily-reports/customer-ordered-products`, ({ request }) => {
        orderedRequests.push(new URL(request.url).searchParams.get("customer_id")!)
        return HttpResponse.json([orderedProduct({ product_id: 100, name: "ピン 製品" })])
      }),
      http.get(`${API_BASE}/daily-reports/product-candidates`, () => {
        candidateRequested = true
        return HttpResponse.json([])
      }),
    )

    render(<Queue kind="product" canEdit />)
    await userEvent.click(
      await screen.findByRole("button", { name: "「ピンA」を「ピン 製品」に対応付ける" }),
    )

    await confirmDialog("登録する")
    await waitFor(() => expect(posts).toHaveLength(1))
    // 登録後に未照合一覧は取り直す（ピンA が消える）が、受注の製品は同じ顧客の行で共有して1回のまま
    await waitFor(() => expect(screen.queryByText("ピンA")).not.toBeInTheDocument())
    expect(screen.getByText("ピンB")).toBeInTheDocument()
    expect(orderedRequests).toEqual(["10"])
    expect(candidateRequested).toBe(false)
  })

  it("顧客先が決まっていない製品は候補を出さず、理由を行ごとに繰り返さない（見出しに1回だけ、#707）", async () => {
    let requested = false
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
        requested = true
        return HttpResponse.json([])
      }),
      http.get(`${API_BASE}/daily-reports/customer-ordered-products`, () => {
        requested = true
        return HttpResponse.json([])
      }),
    )

    render(<Queue kind="product" canEdit />)

    expect(await screen.findByText("顧客先: 未登録の顧客")).toBeInTheDocument()
    expect(screen.queryByText(/を先に「顧客」で対応付けてください/)).not.toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    // 対象外にはできる
    expect(screen.getByRole("button", { name: "「ピン6x20」を対象外にする" })).toBeInTheDocument()
    expect(requested).toBe(false)
  })

  it("「対象外」にした表記は一覧から消え、お知らせから元に戻せる", async () => {
    const posts = mockQueue([
      unmatched({ kind: "product", raw_text: "試作品", customer_raw: null, customer_id: null }),
    ])

    render(<Queue kind="product" canEdit />)
    await userEvent.click(await screen.findByRole("button", { name: "「試作品」を対象外にする" }))
    expect(posts).toEqual([])
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).not.toMatch(/元に戻す|解除/)
    await confirmDialog("対象外にする")

    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: "/daily-reports/ignored-names",
        body: { kind: "product", raw_text: "試作品", customer_raw: null },
      }),
    )
    expect(await screen.findByText("結び付ける製品はありません")).toBeInTheDocument()

    // 戻し方は対象外にしたときのお知らせで伝え、「元に戻す」で取り消せる（Issue #702）
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const [message, options] = vi.mocked(toast.success).mock.calls[0]
    expect(message).toBe("「試作品」を対象外にしました")
    const action = (options as { action: { label: string; onClick: () => void } }).action
    expect(action.label).toBe("元に戻す")
    action.onClick()
    await waitFor(() => expect(ignoredDeletes).toEqual(["ignored-1"]))
    await waitFor(() =>
      expect(toast.success).toHaveBeenLastCalledWith("「試作品」を対象外から戻しました"),
    )
  })

  it("キャンセルすると何も登録せず、行も残る", async () => {
    const posts = mockQueue([unmatched({ raw_text: "組立機B" })])

    render(<Queue canEdit />)
    await openPicker("「組立機B」の設備を選択")
    await userEvent.click(await screen.findByRole("option", { name: /組立.*台帳No\.12/ }))
    await confirmDialog("キャンセル")

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(posts).toEqual([])
    expect(screen.getByRole("button", { name: "組立機B" })).toBeInTheDocument()
  })

  it("「対象外」もキャンセルすると登録しない", async () => {
    const posts = mockQueue([unmatched({ raw_text: "試作機" })])

    render(<Queue canEdit />)
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

    render(<Queue canEdit />)
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
      server.use(
        http.get(`${API_BASE}/daily-reports/customer-ordered-products`, () =>
          HttpResponse.json([
            orderedProduct({
              product_id: 100,
              name: "ピン φ6×20",
              order_count: 2,
              nearest_deadline: "2026-12-05",
            }),
          ]),
        ),
        http.get(`${API_BASE}/daily-reports/product-candidates`, () =>
          HttpResponse.json([
            { product_id: 101, name: "ピン φ6×25", score: 0.6, open_order_count: 0 },
            { product_id: 102, name: "ピン φ8×30", score: 0.5, open_order_count: 0 },
          ]),
        ),
        http.get(`${API_BASE}/daily-reports/customer-open-orders`, () =>
          HttpResponse.json(ORDERS),
        ),
      )
    }

    /** 「他の製品から選択」の「似ている製品」から選ぶ */
    async function pickSimilar(name: string) {
      await openPicker("「ピン6x20」の製品を選択")
      const group = await screen.findByRole("group", { name: "似ている製品" })
      await userEvent.click(await within(group).findByRole("option", { name: new RegExp(name) }))
    }

    it("受注が複数ある製品は、注文の数と直近の希望納期を添える", async () => {
      mockQueue([PRODUCT_ROW])
      mockOrderApis()

      render(<Queue kind="product" canEdit />)

      const button = await screen.findByRole("button", {
        name: "「ピン6x20」を「ピン φ6×20」に対応付ける",
      })
      expect(within(button).getByText("2注文・直近の希望納期 2026/12/05")).toBeInTheDocument()
    })

    it("確認ダイアログに、その製品の確定済み・生産中の受注を出す", async () => {
      mockQueue([PRODUCT_ROW])
      mockOrderApis()

      render(<Queue kind="product" canEdit />)
      await userEvent.click(
        await screen.findByRole("button", { name: "「ピン6x20」を「ピン φ6×20」に対応付ける" }),
      )

      const dialog = await screen.findByRole("alertdialog")
      expect(await within(dialog).findByText("A-001")).toBeInTheDocument()
      expect(within(dialog).getByText("500")).toBeInTheDocument()
      expect(within(dialog).getByText("2026/12/05")).toBeInTheDocument()
      expect(within(dialog).getByText("確定")).toBeInTheDocument()
      expect(within(dialog).getByText("この製品の受注（1注文）")).toBeInTheDocument()
      // 別の製品の受注や承認前の受注は出さない
      expect(within(dialog).queryByText("PO-9")).not.toBeInTheDocument()
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
    })

    it("承認前の受注しかない製品は、そのことを1文で伝えるが、登録はできる", async () => {
      const posts = mockQueue([PRODUCT_ROW])
      mockOrderApis()

      render(<Queue kind="product" canEdit />)
      // 製品101 の受注は下書きのみ（承認前）なので受注の製品には出ず、似ている製品から選ぶ
      await pickSimilar("ピン φ6×25")

      const dialog = await screen.findByRole("alertdialog")
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /^この顧客のこの製品の受注は承認前です$/,
      )
      await confirmDialog("登録する")
      await waitFor(() => expect(posts).toHaveLength(1))
      expect(posts[0].body).toEqual({ raw_text: "ピン6x20", customer_id: 10, product_id: 101 })
    })

    it("受注が1つも無い製品は、受注が無いことを1文で伝える", async () => {
      mockQueue([PRODUCT_ROW])
      mockOrderApis()

      render(<Queue kind="product" canEdit />)
      await pickSimilar("ピン φ8×30")

      const dialog = await screen.findByRole("alertdialog")
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /^この顧客にこの製品の受注がありません$/,
      )
      expect(dialog.textContent).not.toMatch(DAILY_REPORT_FORBIDDEN_UI_TEXT)
    })

    it("受注の取得に失敗したら警告は出さず、登録は続けられる", async () => {
      mockQueue([PRODUCT_ROW])
      mockOrderApis()
      server.use(
        http.get(`${API_BASE}/daily-reports/customer-open-orders`, () =>
          HttpResponse.json({ detail: "error" }, { status: 500 }),
        ),
      )

      render(<Queue kind="product" canEdit />)
      await userEvent.click(
        await screen.findByRole("button", { name: "「ピン6x20」を「ピン φ6×20」に対応付ける" }),
      )

      const dialog = await screen.findByRole("alertdialog")
      expect(await within(dialog).findByText("受注の状況を取得できませんでした")).toBeInTheDocument()
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument()
      expect(within(dialog).getByRole("button", { name: "登録する" })).toBeEnabled()
    })

    it("行の展開部には明細だけを出し、受注の一覧は行の候補と重ねない", async () => {
      mockQueue([PRODUCT_ROW])
      mockOrderApis()
      server.use(
        http.get(`${API_BASE}/daily-reports/name-entries`, () => HttpResponse.json([])),
      )

      render(<Queue kind="product" canEdit />)
      await userEvent.click(await screen.findByRole("button", { name: "ピン6x20" }))

      await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument())
      expect(screen.queryByText(/この顧客の未出荷の受注/)).not.toBeInTheDocument()
      expect(document.body.textContent).not.toMatch(DAILY_REPORT_FORBIDDEN_UI_TEXT)
    })
  })

  describe("製品を登録する (Issue #705)", () => {
    /** 製品の作成と類似製品の問い合わせ。作った製品の ID は 500 */
    function mockCreateProduct({
      similar = [],
      fail = false,
    }: { similar?: SimilarProduct[]; fail?: boolean } = {}) {
      const created: unknown[] = []
      server.use(
        http.get(`${API_BASE}/products/similar`, () => HttpResponse.json({ products: similar })),
        http.post(`${API_BASE}/products`, async ({ request }) => {
          if (fail) return HttpResponse.json({ detail: "error" }, { status: 500 })
          const body = (await request.json()) as { name: string; code: string }
          created.push(body)
          return HttpResponse.json({ id: 500, ...body }, { status: 201 })
        }),
      )
      return created
    }

    const productRow = unmatched({
      kind: "product",
      raw_text: "フィルター 123456",
      customer_raw: "顧客A",
      customer_id: 10,
    })

    async function openCreateDialog() {
      await userEvent.click(
        await screen.findByRole("button", { name: "「フィルター 123456」を製品マスタに登録する" }),
      )
      return screen.findByRole("dialog", { name: "製品を登録する" })
    }

    it("受注の製品の後・他の製品から選択の前に置く", async () => {
      mockQueue([productRow])
      server.use(
        http.get(`${API_BASE}/daily-reports/customer-ordered-products`, () =>
          HttpResponse.json([orderedProduct({ product_id: 100, name: "フィルター" })]),
        ),
      )

      render(<Queue kind="product" canEdit />)

      const create = await screen.findByRole("button", {
        name: "「フィルター 123456」を製品マスタに登録する",
      })
      const ordered = await screen.findByRole("button", {
        name: "「フィルター 123456」を「フィルター」に対応付ける",
      })
      const picker = screen.getByRole("combobox", { name: "「フィルター 123456」の製品を選択" })
      expect(ordered.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(create.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it("日報の品名を初期値に製品を作り、そのまま日報の品名を結び付けて1回で知らせる", async () => {
      const posts = mockQueue([productRow])
      const created = mockCreateProduct()

      render(<Queue kind="product" canEdit />)
      const dialog = await openCreateDialog()

      expect(within(dialog).getByLabelText("品名 *")).toHaveValue("フィルター 123456")
      // 品名に図番らしき番号が1つだけあるので初期値にする
      expect(within(dialog).getByLabelText("図番 *")).toHaveValue("123456")
      expect(within(dialog).getByText(/顧客先: 顧客A/)).toBeInTheDocument()
      expect(dialog.textContent).not.toMatch(DAILY_REPORT_FORBIDDEN_UI_TEXT)

      await userEvent.click(within(dialog).getByRole("button", { name: "登録して結び付ける" }))

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          "製品「フィルター 123456」を登録し、日報の品名を結び付けました",
        ),
      )
      expect(created).toEqual([{ name: "フィルター 123456", code: "123456" }])
      expect(posts).toEqual([
        {
          path: "/daily-reports/name-aliases/product",
          body: { raw_text: "フィルター 123456", customer_id: 10, product_id: 500 },
        },
      ])
      expect(toast.success).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(screen.queryByText("フィルター 123456")).not.toBeInTheDocument()
    })

    it("品名から図番を読み取れなければ図番を空にし、入れるまで作らない", async () => {
      mockQueue([
        unmatched({ kind: "product", raw_text: "ピン6x20", customer_raw: "顧客A", customer_id: 10 }),
      ])
      const created = mockCreateProduct()

      render(<Queue kind="product" canEdit />)
      await userEvent.click(
        await screen.findByRole("button", { name: "「ピン6x20」を製品マスタに登録する" }),
      )
      const dialog = await screen.findByRole("dialog", { name: "製品を登録する" })

      expect(within(dialog).getByLabelText("図番 *")).toHaveValue("")
      await userEvent.click(within(dialog).getByRole("button", { name: "登録して結び付ける" }))
      expect(toast.error).toHaveBeenCalledWith("図番を入力してください")
      expect(created).toEqual([])
    })

    it("結び付けだけ失敗したら、製品が残ったことと次の操作を伝え、行は一覧に残す", async () => {
      mockQueue([productRow])
      const created = mockCreateProduct()
      server.use(
        http.post(`${API_BASE}/daily-reports/name-aliases/product`, () =>
          HttpResponse.json({ detail: "error" }, { status: 500 }),
        ),
      )

      render(<Queue kind="product" canEdit />)
      const dialog = await openCreateDialog()
      await userEvent.click(within(dialog).getByRole("button", { name: "登録して結び付ける" }))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          "製品「フィルター 123456」を登録しました。日報の品名は結び付けられませんでした",
          { description: "「他の製品から選択」で結び付けられます" },
        ),
      )
      expect(created).toHaveLength(1)
      expect(toast.success).not.toHaveBeenCalled()
      // 製品は作れたので、もう一度作らないようダイアログは閉じる
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(screen.getByRole("button", { name: "フィルター 123456" })).toBeInTheDocument()
    })

    it("製品の作成に失敗したら、結び付けず、ダイアログを開いたままにする", async () => {
      const posts = mockQueue([productRow])
      mockCreateProduct({ fail: true })

      render(<Queue kind="product" canEdit />)
      const dialog = await openCreateDialog()
      await userEvent.click(within(dialog).getByRole("button", { name: "登録して結び付ける" }))

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("製品の作成に失敗しました"))
      expect(posts).toEqual([])
      expect(screen.getByRole("dialog", { name: "製品を登録する" })).toBeInTheDocument()
    })

    it("似た製品があれば、作らずにその製品へ確認ダイアログを経て結び付けられる", async () => {
      const posts = mockQueue([productRow])
      const created = mockCreateProduct({
        similar: [
          {
            id: 77,
            name: "フィルター φ10×20L",
            code: "123456",
            is_active: true,
            prefix: "",
            prefix_differs: false,
            has_process: true,
            has_unconfirmed_process: false,
          },
        ],
      })

      render(<Queue kind="product" canEdit />)
      const dialog = await openCreateDialog()
      await userEvent.click(
        await within(dialog).findByRole("button", { name: "「フィルター φ10×20L」に結び付ける" }),
      )

      expect(screen.queryByRole("dialog", { name: "製品を登録する" })).not.toBeInTheDocument()
      const confirm = await screen.findByRole("alertdialog")
      expect(within(confirm).getByText("フィルター φ10×20L")).toBeInTheDocument()
      await confirmDialog("登録する")
      await waitFor(() =>
        expect(posts).toEqual([
          {
            path: "/daily-reports/name-aliases/product",
            body: { raw_text: "フィルター 123456", customer_id: 10, product_id: 77 },
          },
        ]),
      )
      expect(created).toEqual([])
    })

    it("顧客先が決まっていない製品・編集できないロールには出さない", async () => {
      mockQueue([
        unmatched({ kind: "product", raw_text: "ピン6x20", customer_raw: "未登録の顧客先", customer_id: null }),
        unmatched({ kind: "product", raw_text: "カラー", customer_raw: "顧客A", customer_id: 10 }),
      ])

      const { unmount } = render(<Queue kind="product" canEdit />)
      expect(
        await screen.findByRole("button", { name: "「カラー」を製品マスタに登録する" }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "「ピン6x20」を製品マスタに登録する" }),
      ).not.toBeInTheDocument()
      unmount()

      render(<Queue kind="product" />)
      expect(await screen.findByRole("button", { name: "カラー" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /製品マスタに登録する/ })).not.toBeInTheDocument()
    })
  })

  it("編集できないロールには操作を出さない", async () => {
    mockQueue([unmatched({ raw_text: "組立機B" })])

    render(<Queue />)

    expect(await screen.findByRole("button", { name: "組立機B" })).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /対象外にする/ })).not.toBeInTheDocument()
  })
})
