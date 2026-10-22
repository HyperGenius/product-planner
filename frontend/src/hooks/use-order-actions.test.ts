import { beforeEach, describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import { toast } from "sonner"
import { act, renderHook, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { Order, OrderSimulateResponse } from "@/types/order"
import { useOrderActions } from "./use-order-actions"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: "2026-09-30",
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

const simResult: OrderSimulateResponse = {
  calculated_deadline: "2026-09-20T17:00:00+09:00",
  is_feasible: true,
  process_schedules: [],
}

describe("useOrderActions（Issue #554）", () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  describe("承認", () => {
    const order = makeOrder({ id: 5, order_no: "O-5", status: "pending_approval" })

    it("行から開いた確認モーダルで承認すると API を呼び、成功トーストを出して閉じる", async () => {
      const confirmed = vi.fn()
      server.use(
        http.post(`${API_BASE}/orders/5/confirm`, () => {
          confirmed()
          return HttpResponse.json({})
        }),
      )
      const { result } = renderHook(() => useOrderActions([order]))

      act(() => result.current.handleApproveFromRow(order))
      expect(result.current.approveTargetOrder).toEqual(order)

      act(() => result.current.handleConfirmApprove())

      await waitFor(() => expect(result.current.approveTargetOrder).toBeNull())
      expect(confirmed).toHaveBeenCalledTimes(1)
      expect(toast.success).toHaveBeenCalledWith("注文「O-5」を承認し、スケジュールを作成しました")
    })

    it("失敗したら確認モーダルを開いたまま、エラートーストを出す", async () => {
      server.use(
        http.post(`${API_BASE}/orders/5/confirm`, () =>
          HttpResponse.json({ detail: "承認できません" }, { status: 400 }),
        ),
      )
      const { result } = renderHook(() => useOrderActions([order]))

      act(() => result.current.handleApproveFromRow(order))
      act(() => result.current.handleConfirmApprove())

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("承認に失敗しました: 承認できません"),
      )
      expect(result.current.approveTargetOrder).toEqual(order)
    })
  })

  it("承認依頼に成功すると確認モーダルを閉じ、結果モーダルの対象にする（Issue #426）", async () => {
    const order = makeOrder({ id: 3, is_scheduled: true })
    server.use(
      http.post(`${API_BASE}/orders/3/request-approval`, () =>
        HttpResponse.json({ ...order, status: "pending_approval" }),
      ),
    )
    const { result } = renderHook(() => useOrderActions([order]))

    act(() => result.current.handleRequestApprovalFromRow(order))
    act(() => result.current.handleConfirmRequestApproval())

    await waitFor(() => expect(result.current.requestApprovalResultOrder).toEqual(order))
    expect(result.current.requestApprovalTargetOrder).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  })

  describe("シミュレーション", () => {
    it("成功するとシミュ結果の対象にし、閉じると解除する", async () => {
      const order = makeOrder({ id: 2 })
      server.use(
        http.post(`${API_BASE}/orders/2/simulate`, () => HttpResponse.json(simResult)),
      )
      const { result } = renderHook(() => useOrderActions([order]))

      await act(() => result.current.handleSimulate(order))

      expect(result.current.expandedOrder).toEqual(order)
      expect(result.current.expandedSimResult).toEqual(simResult)
      expect(result.current.simulatingOrderId).toBeNull()

      act(() => result.current.closeSimResult())

      expect(result.current.expandedOrder).toBeNull()
      expect(result.current.expandedSimResult).toBeNull()
    })

    it("工程未設定（422 no_routing）なら行にエラーを残し、工程設定へ誘導するトーストを出す", async () => {
      const order = makeOrder({ id: 2 })
      server.use(
        http.post(`${API_BASE}/orders/2/simulate`, () =>
          HttpResponse.json({ detail: { error: "no_routing" } }, { status: 422 }),
        ),
      )
      const { result } = renderHook(() => useOrderActions([order]))

      await act(() => result.current.handleSimulate(order))

      expect(result.current.simulationErrorOrderId).toBe(2)
      expect(result.current.getRowProps(order).hasSimulationError).toBe(true)
      expect(toast.error).toHaveBeenCalledWith(
        "工程が設定されていないため、シミュレーションを実行できません。",
        expect.objectContaining({ description: "製品マスタから工程を設定してください。" }),
      )
    })
  })

  it("シミュ結果を表示中の注文を削除するとシミュ結果も閉じる", async () => {
    const order = makeOrder({ id: 4 })
    server.use(
      http.post(`${API_BASE}/orders/4/simulate`, () => HttpResponse.json(simResult)),
      http.delete(`${API_BASE}/orders/4`, () => new HttpResponse(null, { status: 204 })),
    )
    const { result } = renderHook(() => useOrderActions([order]))

    await act(() => result.current.handleSimulate(order))
    act(() => result.current.getRowProps(order).onDelete(order))
    expect(result.current.deleteTargetOrder).toEqual(order)

    act(() => result.current.handleConfirmDelete())

    await waitFor(() => expect(result.current.deleteTargetOrder).toBeNull())
    expect(result.current.expandedSimResult).toBeNull()
    expect(toast.success).toHaveBeenCalledWith("注文を削除しました")
  })

  it("工程未入力の例外送品は確認モーダルを挟み、成功したら閉じる（Issue #547）", async () => {
    const order = makeOrder({ id: 6, order_no: "O-6", has_no_routings: true })
    server.use(
      http.post(`${API_BASE}/orders/6/ship-without-routing`, () =>
        HttpResponse.json({ ...order, status: "shipped" }),
      ),
    )
    const { result } = renderHook(() => useOrderActions([order]))

    act(() => result.current.getRowProps(order).onShipWithoutRouting(order))
    expect(result.current.shipWithoutRoutingTarget).toEqual(order)

    act(() => result.current.handleShipWithoutRoutingConfirm())

    await waitFor(() => expect(result.current.shipWithoutRoutingTarget).toBeNull())
    expect(toast.success).toHaveBeenCalledWith("注文「O-6」を送品済みにしました")
  })

  it("閲覧中の注文は一覧の再取得結果から引き直す（Issue #527）", () => {
    const order = makeOrder({ id: 7, status: "confirmed" })
    const { result, rerender } = renderHook(({ orders }) => useOrderActions(orders), {
      initialProps: { orders: [order] },
    })

    act(() => result.current.getRowProps(order).onView(order))
    expect(result.current.isViewDialogOpen).toBe(true)

    const shipped = { ...order, status: "shipped" as const }
    rerender({ orders: [shipped] })

    expect(result.current.viewingOrder).toEqual(shipped)
  })

  it("編集を開くたびにダイアログの世代を進める（再マウントで入力を初期化するため）", () => {
    const order = makeOrder({ id: 8 })
    const { result } = renderHook(() => useOrderActions([order]))

    act(() => result.current.getRowProps(order).onEdit(order))
    const generation = result.current.editDialogGeneration
    act(() => result.current.getRowProps(order).onEdit(order))

    expect(result.current.editingOrder).toEqual(order)
    expect(result.current.isEditDialogOpen).toBe(true)
    expect(result.current.editDialogGeneration).toBe(generation + 1)
  })
})
