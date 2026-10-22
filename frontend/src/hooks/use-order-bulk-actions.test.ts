import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { act, renderHook, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Order } from "@/types/order"
import { useOrderBulkActions } from "./use-order-bulk-actions"

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: "2099-09-30",
    status: "draft",
    customer_certainty: null,
    is_scheduled: false,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

const draftA = makeOrder({ id: 1, order_no: "O-1" })
const draftB = makeOrder({ id: 2, order_no: "O-2", is_scheduled: true })
const pending = makeOrder({ id: 3, order_no: "O-3", status: "pending_approval" })
const orders = [draftA, draftB, pending]

function renderBulk(selectionResetKey = "1") {
  return renderHook(
    ({ resetKey }) => useOrderBulkActions({ orders, pageOrders: orders, selectionResetKey: resetKey }),
    { initialProps: { resetKey: selectionResetKey } },
  )
}

describe("useOrderBulkActions（Issue #554）", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.warning).mockClear()
  })

  it("選択した順に番号を振り、行の props に反映する", () => {
    const { result } = renderBulk()

    act(() => result.current.handleToggleSelect(2))
    act(() => result.current.handleToggleSelect(1))

    expect(result.current.getRowProps(draftB)).toMatchObject({ isSelected: true, selectionIndex: 1 })
    expect(result.current.getRowProps(draftA)).toMatchObject({ isSelected: true, selectionIndex: 2 })
    expect(result.current.getRowProps(pending)).toMatchObject({
      isSelected: false,
      selectionIndex: undefined,
    })
    expect(result.current.selectedScheduledOrders).toEqual([draftB])
  })

  it("ページ内の全選択は下書きだけを対象にし、もう一度で解除する", () => {
    const { result } = renderBulk()

    act(() => result.current.handleToggleSelectAll())
    expect(result.current.selectedOrderIds).toEqual([1, 2])
    expect(result.current.allDraftOnPageSelected).toBe(true)

    act(() => result.current.handleToggleSelectAll())
    expect(result.current.selectedOrderIds).toEqual([])
  })

  it("selectionResetKey が変わったら選択を解除する（ページ・絞り込みの切り替え）", () => {
    const { result, rerender } = renderBulk("1")

    act(() => result.current.handleToggleSelect(1))
    rerender({ resetKey: "2" })

    expect(result.current.selectedOrderIds).toEqual([])
  })

  it("一括承認依頼はシミュ済みだけを送り、未シミュはスキップとして件数に出す", async () => {
    const requested: number[] = []
    server.use(
      http.post(`${API_BASE}/orders/:id/request-approval`, ({ params }) => {
        requested.push(Number(params.id))
        return HttpResponse.json({})
      }),
    )
    const { result } = renderBulk()

    act(() => result.current.handleToggleSelect(1))
    act(() => result.current.handleToggleSelect(2))
    act(() => result.current.handleBulkRequestApprovalRequest())
    expect(result.current.isBulkRequestApprovalConfirmOpen).toBe(true)

    await act(() => result.current.handleBulkRequestApprovalConfirm())

    expect(requested).toEqual([2])
    expect(result.current.isBulkRequestApprovalConfirmOpen).toBe(false)
    expect(result.current.selectedOrderIds).toEqual([])
    expect(toast.warning).toHaveBeenCalledWith(
      "一括承認依頼完了: 成功 1件 / スキップ 1件（未スケジュール）",
    )
  })

  it("一括シミュは結果の一覧を出し、失敗・納期に間に合わない行を失敗としてハイライトする", async () => {
    server.use(
      http.post(`${API_BASE}/orders/:id/simulate`, ({ params }) =>
        Number(params.id) === 1
          ? HttpResponse.json({ detail: "boom" }, { status: 500 })
          : HttpResponse.json({
              calculated_deadline: "2026-09-20T17:00:00+09:00",
              is_feasible: true,
              process_schedules: [],
            }),
      ),
      http.get(`${API_BASE}/orders`, () => HttpResponse.json(orders)),
    )
    const { result } = renderBulk()

    act(() => result.current.handleToggleSelect(1))
    act(() => result.current.handleToggleSelect(2))
    await act(() => result.current.handleBulkSimulateConfirm())

    expect(result.current.bulkSimSummary?.map((r) => [r.orderId, r.result === null])).toEqual([
      [1, true],
      [2, false],
    ])
    expect(result.current.getRowProps(draftA).hasBulkSimFailed).toBe(true)
    expect(result.current.getRowProps(draftB).hasBulkSimFailed).toBe(false)
    expect(result.current.isBulkSimulating).toBe(false)
    expect(result.current.selectedOrderIds).toEqual([])
  })

  it("一括承認は承認待ちだけを送る", async () => {
    let body: unknown
    server.use(
      http.post(`${API_BASE}/orders/approve-bulk`, async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ results: [{ order_id: 3, status: "confirmed" }] })
      }),
    )
    const { result } = renderBulk()

    act(() => result.current.handleToggleSelect(1))
    act(() => result.current.handleToggleSelect(3))
    await act(() => result.current.handleBulkApproveConfirm())

    expect(body).toEqual({ order_ids: [3] })
    expect(toast.success).toHaveBeenCalledWith("一括承認完了: 成功 1件")
    expect(result.current.isBulkApproving).toBe(false)
  })

  it("納期超過の下書きを数え、一括送品の件数をトーストに出す（Issue #367）", async () => {
    const overdue = makeOrder({ id: 9, desired_deadline: "2000-01-01" })
    server.use(
      http.post(`${API_BASE}/orders/ship-overdue-drafts`, () =>
        HttpResponse.json({ shipped_count: 1 }),
      ),
    )
    const { result } = renderHook(() =>
      useOrderBulkActions({ orders: [...orders, overdue], pageOrders: orders, selectionResetKey: "1" }),
    )

    expect(result.current.overdueDraftOrders).toEqual([overdue])

    act(() => result.current.handleShipOverdueDraftsConfirm())

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("納期超過の下書き 1 件を送品済みにしました"),
    )
  })
})
