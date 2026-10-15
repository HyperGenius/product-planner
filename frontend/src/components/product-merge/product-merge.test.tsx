import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { render, screen, userEvent, waitFor, within } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type {
  ProductMergeBlocker,
  ProductMergeCandidate,
  ProductMergeCandidatesResponse,
  ProductMergePreview,
  ProductMergeRequest,
} from "@/types/product"
import { ProductMerge } from "./product-merge"

/** 重複製品の統合画面 (Issue #515)。品名・受注番号はダミー値（実データを含めない） */

function candidate(overrides: Partial<ProductMergeCandidate>): ProductMergeCandidate {
  return {
    id: 1,
    name: "φ10.0×20L SUS100",
    code: null,
    is_active: true,
    prefix: "",
    prefix_key: "",
    routing_count: 2,
    timed_routing_count: 2,
    has_decimal_time: false,
    order_counts: {},
    alias_count: 0,
    rank: 2,
    ...overrides,
  }
}

const CANDIDATES = [
  candidate({ id: 1, rank: 3, has_decimal_time: true, order_counts: { confirmed: 2 } }),
  candidate({ id: 2, name: "10φ×20L (SUS100)", routing_count: 0, timed_routing_count: 0, rank: 0 }),
  candidate({ id: 3, name: "φ10x20 sus100", is_active: false, rank: 1, timed_routing_count: 0 }),
  candidate({ id: 4, name: "A社φ10×20L SUS100", prefix: "A社", prefix_key: "A社" }),
]

function previewFor(
  request: ProductMergeRequest,
  blockers: ProductMergeBlocker[] = []
): ProductMergePreview {
  return {
    ...request,
    counts: {
      orders_reassigned: 3,
      schedules_reassigned: 5,
      aliases_reassigned: 1,
      alias_history_reassigned: 2,
      orders_deleted: 1,
      routings_deleted: 4,
      products_deleted: request.merge_product_ids.length,
    },
    deleted_orders: [{ id: 900, order_number: "ORD-900", product_id: 2, status: "shipped" }],
    blockers,
  }
}

function mockApi({
  role = "president",
  response = { candidates: CANDIDATES, default_keep_product_id: 1 },
  blockers = [],
}: {
  role?: string
  response?: Pick<ProductMergeCandidatesResponse, "candidates" | "default_keep_product_id">
  blockers?: ProductMergeBlocker[]
} = {}) {
  const calls = { candidates: [] as string[], previews: [] as ProductMergeRequest[], merges: [] as ProductMergeRequest[] }
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u1", email: "user@example.com", full_name: null, role })
    ),
    http.get(`${API_BASE}/products/merge-candidates`, ({ request }) => {
      calls.candidates.push(new URL(request.url).search)
      return HttpResponse.json({ diameter: "10", length: "20", material: "SUS100", ...response })
    }),
    http.post(`${API_BASE}/products/merge/preview`, async ({ request }) => {
      const body = (await request.json()) as ProductMergeRequest
      calls.previews.push(body)
      return HttpResponse.json(previewFor(body, blockers))
    }),
    http.post(`${API_BASE}/products/merge`, async ({ request }) => {
      const body = (await request.json()) as ProductMergeRequest
      calls.merges.push(body)
      return HttpResponse.json(previewFor(body).counts)
    })
  )
  return calls
}

async function search() {
  await userEvent.type(await screen.findByLabelText("直径 *"), "１０．０")
  await userEvent.type(screen.getByLabelText("長さ *"), "20")
  await userEvent.type(screen.getByLabelText("材質"), "SUS100")
  await userEvent.click(screen.getByRole("button", { name: "候補を検索" }))
}

describe("ProductMerge", () => {
  it("社長・プラットフォーム管理者以外には画面を出さない", async () => {
    const calls = mockApi({ role: "order_handler" })

    render(<ProductMerge />)

    expect(await screen.findByText(/社長・プラットフォーム管理者が行えます/)).toBeInTheDocument()
    expect(screen.queryByLabelText("直径 *")).not.toBeInTheDocument()
    expect(calls.candidates).toEqual([])
  })

  it("候補を検索し、初期選択の製品へ統合する", async () => {
    const calls = mockApi()

    render(<ProductMerge />)
    await search()

    // 全角の数字は半角にして送る
    await waitFor(() => expect(calls.candidates).toHaveLength(1))
    const query = new URLSearchParams(calls.candidates[0])
    expect([query.get("diameter"), query.get("length"), query.get("material")]).toEqual([
      "10.0",
      "20",
      "SUS100",
    ])

    expect(await screen.findByRole("radio", { name: "「φ10.0×20L SUS100」を残す" })).toBeChecked()
    // 接頭辞が違う候補はチェックできず理由を出す
    const prefixed = screen.getByTestId("merge-candidate-4")
    expect(within(prefixed).getByRole("checkbox")).toBeDisabled()
    expect(within(prefixed).getByText(/接頭辞が残す製品と違うため統合できません/)).toBeInTheDocument()
    expect(within(screen.getByTestId("merge-candidate-3")).getByText("無効")).toBeInTheDocument()

    // 統合される側を個別に外す
    await userEvent.click(screen.getByRole("checkbox", { name: "「φ10x20 sus100」を統合する" }))
    await waitFor(() =>
      expect(calls.previews.at(-1)).toEqual({ keep_product_id: 1, merge_product_ids: [2] })
    )

    const execute = screen.getByRole("button", { name: "1件を統合" })
    await waitFor(() => expect(execute).toBeEnabled())
    await userEvent.click(execute)

    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("受注 3件")).toBeInTheDocument()
    expect(within(dialog).getByText(/スケジュールのセグメント 5件/)).toBeInTheDocument()
    expect(within(dialog).getByText(/送品済みの受注 1件（\s*ORD-900）/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole("button", { name: "統合する" }))

    await waitFor(() =>
      expect(calls.merges).toEqual([{ keep_product_id: 1, merge_product_ids: [2] }])
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("正しさが同順位なら残す製品を初期選択しない", async () => {
    const calls = mockApi({
      response: { candidates: CANDIDATES.slice(0, 2), default_keep_product_id: null },
    })

    render(<ProductMerge />)
    await search()

    expect(await screen.findByText(/残す製品を選んでください。/)).toBeInTheDocument()
    expect(screen.getAllByRole("radio").every((r) => !(r as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByRole("button", { name: "統合" })).toBeDisabled()

    await userEvent.click(screen.getByRole("radio", { name: "「10φ×20L (SUS100)」を残す" }))
    await waitFor(() =>
      expect(calls.previews.at(-1)).toEqual({ keep_product_id: 2, merge_product_ids: [1] })
    )
  })

  it("統合を止める理由があれば実行できない", async () => {
    mockApi({
      blockers: [
        {
          reason: "order_conflict",
          product_id: 2,
          product_name: "10φ×20L (SUS100)",
          order_id: 101,
          order_number: "ORD-101",
          order_status: "in_progress",
          conflicting_order_id: 100,
          conflicting_order_number: "ORD-100",
          sequence_order: null,
        },
      ],
    })

    render(<ProductMerge />)
    await search()

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText(/ORD-101（生産中） と ORD-100 が衝突します/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "2件を統合" })).toBeDisabled()
  })
})
