"use client"

import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  useApproveOrdersBulk,
  useRequestApproval,
  useShipOverdueDrafts,
  useSimulateOrderById,
} from "@/hooks/use-orders"
import type { OrderTableRowProps } from "@/components/orders/order-table-row"
import { isOverdueDraft } from "@/lib/order-utils"
import type { Order, BulkSimulateResult } from "@/types/order"

/** `OrderTableRow` に渡す一括選択の props（`useOrderBulkActions().getRowProps()` の戻り値） */
export type OrderRowBulkProps = Pick<
  OrderTableRowProps,
  "isSelected" | "selectionIndex" | "isBulkOperationInProgress" | "hasBulkSimFailed" | "onToggleSelect"
>

interface UseOrderBulkActionsOptions {
  /** 一覧の全注文（選択中の ID から注文を引く・納期超過の下書きを数えるのに使う） */
  orders: Order[] | undefined
  /** 表示中のページの注文（ページ内の全選択に使う） */
  pageOrders: Order[]
  /** この値が変わったら選択とバルクシミュ失敗のハイライトを解除する（ページ・絞り込みの切り替え） */
  selectionResetKey: string
}

/**
 * 一括操作（一括シミュ・一括承認依頼・一括承認・納期超過の下書きの一括送品）の選択状態と実行をまとめたフック（Issue #554）。
 * 確認ダイアログ群は戻り値をそのまま `OrderBulkActionDialogs` に渡して描画する。
 */
export function useOrderBulkActions({ orders, pageOrders, selectionResetKey }: UseOrderBulkActionsOptions) {
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([])
  const [isBulkSimulating, setIsBulkSimulating] = useState(false)
  const [isBulkRequestingApproval, setIsBulkRequestingApproval] = useState(false)
  const [isBulkApproving, setIsBulkApproving] = useState(false)
  const [isBulkSimulateConfirmOpen, setIsBulkSimulateConfirmOpen] = useState(false)
  const [bulkSimSummary, setBulkSimSummary] = useState<BulkSimulateResult[] | null>(null)
  const [bulkSimFailedIds, setBulkSimFailedIds] = useState<Set<number>>(new Set())
  const [isBulkRequestApprovalConfirmOpen, setIsBulkRequestApprovalConfirmOpen] = useState(false)
  const [isBulkApproveConfirmOpen, setIsBulkApproveConfirmOpen] = useState(false)
  const [isShipOverdueDraftsConfirmOpen, setIsShipOverdueDraftsConfirmOpen] = useState(false)

  const queryClient = useQueryClient()
  const requestApproval = useRequestApproval()
  const simulateOrderById = useSimulateOrderById()
  const approveOrdersBulk = useApproveOrdersBulk()
  const shipOverdueDrafts = useShipOverdueDrafts()

  const isBulkOperationInProgress = isBulkSimulating || isBulkRequestingApproval || isBulkApproving

  // 納期を過ぎたまま残っている下書き（president / platform_admin が一括で送品済みにできる）
  const overdueDraftOrders = orders?.filter((o) => isOverdueDraft(o)) ?? []

  const draftPageOrders = useMemo(
    () => pageOrders.filter((o) => o.status === "draft"),
    [pageOrders]
  )
  const pendingApprovalPageOrders = useMemo(
    () => pageOrders.filter((o) => o.status === "pending_approval"),
    [pageOrders]
  )
  const selectedOrders = useMemo(
    () =>
      selectedOrderIds
        .map((id) => orders?.find((o) => o.id === id))
        .filter((o): o is Order => o != null),
    [selectedOrderIds, orders]
  )
  const selectedScheduledOrders = useMemo(
    () => selectedOrders.filter((o) => o.is_scheduled === true),
    [selectedOrders]
  )
  const selectedPendingApprovalOrders = useMemo(
    () => selectedOrders.filter((o) => o.status === "pending_approval"),
    [selectedOrders]
  )
  const selectedScheduledCount = selectedScheduledOrders.length
  const selectedPendingApprovalCount = selectedPendingApprovalOrders.length
  const allDraftOnPageSelected =
    draftPageOrders.length > 0 && draftPageOrders.every((o) => selectedOrderIds.includes(o.id))
  const someDraftOnPageSelected =
    draftPageOrders.some((o) => selectedOrderIds.includes(o.id)) && !allDraftOnPageSelected
  const allPendingApprovalOnPageSelected =
    pendingApprovalPageOrders.length > 0 &&
    pendingApprovalPageOrders.every((o) => selectedOrderIds.includes(o.id))
  const somePendingApprovalOnPageSelected =
    pendingApprovalPageOrders.some((o) => selectedOrderIds.includes(o.id)) &&
    !allPendingApprovalOnPageSelected

  useEffect(() => {
    setSelectedOrderIds([])
    setBulkSimFailedIds(new Set())
  }, [selectionResetKey])

  const handleToggleSelect = (orderId: number) => {
    setSelectedOrderIds((prev) =>
      prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]
    )
  }

  const handleToggleSelectAll = () => {
    setSelectedOrderIds((prev) => {
      if (allDraftOnPageSelected) {
        return prev.filter((id) => !draftPageOrders.some((o) => o.id === id))
      } else {
        const newIds = draftPageOrders.map((o) => o.id).filter((id) => !prev.includes(id))
        return [...prev, ...newIds]
      }
    })
  }

  const handleToggleSelectAllPendingApproval = () => {
    setSelectedOrderIds((prev) => {
      if (allPendingApprovalOnPageSelected) {
        return prev.filter((id) => !pendingApprovalPageOrders.some((o) => o.id === id))
      } else {
        const newIds = pendingApprovalPageOrders
          .map((o) => o.id)
          .filter((id) => !prev.includes(id))
        return [...prev, ...newIds]
      }
    })
  }

  const handleClearSelection = () => setSelectedOrderIds([])

  const handleBulkSimulateRequest = () => setIsBulkSimulateConfirmOpen(true)

  const handleBulkSimulateCancel = () => setIsBulkSimulateConfirmOpen(false)

  const handleBulkSimulateConfirm = async () => {
    setIsBulkSimulateConfirmOpen(false)
    const ids = selectedOrderIds
    setIsBulkSimulating(true)
    setBulkSimFailedIds(new Set())
    const results: BulkSimulateResult[] = []
    for (const id of ids) {
      const order = orders?.find((o) => o.id === id)
      const orderNo = order?.order_no ?? String(id)
      try {
        const result = await simulateOrderById.mutateAsync(id)
        results.push({ orderId: id, orderNo, desiredDeadline: order?.desired_deadline, result })
      } catch {
        results.push({ orderId: id, orderNo, desiredDeadline: order?.desired_deadline, result: null })
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["orders"] })
    const failedIds = new Set(
      results.filter((r) => r.result === null || !r.result.is_feasible).map((r) => r.orderId)
    )
    setBulkSimFailedIds(failedIds)
    setSelectedOrderIds([])
    setIsBulkSimulating(false)
    setBulkSimSummary(results)
  }

  const handleCloseBulkSimSummary = () => setBulkSimSummary(null)

  const handleBulkRequestApprovalFromSummary = async (orderIds: number[]) => {
    setIsBulkRequestingApproval(true)
    let successCount = 0, failCount = 0
    for (const id of orderIds) {
      try {
        await requestApproval.mutateAsync(id)
        successCount++
      } catch {
        failCount++
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["orders"] })
    setIsBulkRequestingApproval(false)
    const parts = (
      [
        successCount > 0 ? `成功 ${successCount}件` : null,
        failCount > 0 ? `失敗 ${failCount}件` : null,
      ] as (string | null)[]
    ).filter((p): p is string => p !== null).join(" / ")
    if (failCount === 0) {
      toast.success(`一括承認依頼完了: ${parts}`)
    } else if (successCount === 0) {
      toast.error(`一括承認依頼失敗: ${parts}`)
    } else {
      toast.warning(`一括承認依頼完了: ${parts}`)
    }
  }

  const handleBulkRequestApprovalRequest = () => setIsBulkRequestApprovalConfirmOpen(true)

  const handleBulkRequestApprovalCancel = () => setIsBulkRequestApprovalConfirmOpen(false)

  const handleBulkRequestApprovalConfirm = async () => {
    setIsBulkRequestApprovalConfirmOpen(false)
    const ids = selectedOrderIds
    const scheduledIds = ids.filter((id) => orders?.find((o) => o.id === id)?.is_scheduled)
    const skippedCount = ids.length - scheduledIds.length
    setIsBulkRequestingApproval(true)
    let successCount = 0, failCount = 0
    for (const id of scheduledIds) {
      try {
        await requestApproval.mutateAsync(id)
        successCount++
      } catch {
        failCount++
      }
    }
    setIsBulkRequestingApproval(false)
    setSelectedOrderIds([])
    const parts = (
      [
        successCount > 0 ? `成功 ${successCount}件` : null,
        failCount > 0 ? `失敗 ${failCount}件` : null,
        skippedCount > 0 ? `スキップ ${skippedCount}件（未スケジュール）` : null,
      ] as (string | null)[]
    ).filter((p): p is string => p !== null).join(" / ")
    if (failCount === 0 && skippedCount === 0) {
      toast.success(`一括承認依頼完了: ${parts}`)
    } else if (successCount === 0 && failCount > 0) {
      toast.error(`一括承認依頼失敗: ${parts}`)
    } else {
      toast.warning(`一括承認依頼完了: ${parts}`)
    }
  }

  const handleBulkApproveRequest = () => setIsBulkApproveConfirmOpen(true)

  const handleBulkApproveCancel = () => setIsBulkApproveConfirmOpen(false)

  const handleBulkApproveConfirm = async () => {
    setIsBulkApproveConfirmOpen(false)
    const ids = selectedOrderIds.filter(
      (id) => orders?.find((o) => o.id === id)?.status === "pending_approval"
    )
    if (ids.length === 0) return
    setIsBulkApproving(true)
    try {
      const res = await approveOrdersBulk.mutateAsync(ids)
      const successCount = res.results.filter((r) => r.status === "confirmed").length
      const failCount = res.results.length - successCount
      setSelectedOrderIds([])
      if (failCount === 0) {
        toast.success(`一括承認完了: 成功 ${successCount}件`)
      } else if (successCount === 0) {
        toast.error(`一括承認失敗: ${failCount}件`)
      } else {
        toast.warning(`一括承認完了: 成功 ${successCount}件 / 失敗 ${failCount}件`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? `一括承認に失敗しました: ${error.message}` : "一括承認に失敗しました")
    } finally {
      setIsBulkApproving(false)
    }
  }

  const handleShipOverdueDraftsRequest = () => setIsShipOverdueDraftsConfirmOpen(true)

  const handleShipOverdueDraftsCancel = () => setIsShipOverdueDraftsConfirmOpen(false)

  const handleShipOverdueDraftsConfirm = () => {
    setIsShipOverdueDraftsConfirmOpen(false)
    shipOverdueDrafts.mutate(undefined, {
      onSuccess: (res) => {
        if (res.shipped_count === 0) {
          toast.info("対象となる納期超過の下書きはありませんでした")
        } else {
          toast.success(`納期超過の下書き ${res.shipped_count} 件を送品済みにしました`)
        }
      },
      onError: (error: Error) => {
        toast.error(`送品済みへの一括変更に失敗しました: ${error.message}`)
      },
    })
  }

  const getRowProps = (order: Order): OrderRowBulkProps => {
    const index = selectedOrderIds.indexOf(order.id)
    return {
      isSelected: index !== -1,
      selectionIndex: index !== -1 ? index + 1 : undefined,
      isBulkOperationInProgress,
      hasBulkSimFailed: bulkSimFailedIds.has(order.id),
      onToggleSelect: handleToggleSelect,
    }
  }

  return {
    getRowProps,
    // 選択
    selectedOrderIds,
    selectedOrders,
    selectedScheduledCount,
    selectedPendingApprovalCount,
    selectedScheduledOrders,
    selectedPendingApprovalOrders,
    draftPageOrders,
    pendingApprovalPageOrders,
    allDraftOnPageSelected,
    someDraftOnPageSelected,
    allPendingApprovalOnPageSelected,
    somePendingApprovalOnPageSelected,
    handleToggleSelect,
    handleToggleSelectAll,
    handleToggleSelectAllPendingApproval,
    handleClearSelection,
    // 実行状態
    isBulkSimulating,
    isBulkRequestingApproval,
    isBulkApproving,
    isBulkOperationInProgress,
    // 一括シミュ
    isBulkSimulateConfirmOpen,
    handleBulkSimulateRequest,
    handleBulkSimulateConfirm,
    handleBulkSimulateCancel,
    bulkSimSummary,
    bulkSimFailedIds,
    handleCloseBulkSimSummary,
    handleBulkRequestApprovalFromSummary,
    // 一括承認依頼
    isBulkRequestApprovalConfirmOpen,
    handleBulkRequestApprovalRequest,
    handleBulkRequestApprovalConfirm,
    handleBulkRequestApprovalCancel,
    // 一括承認
    isBulkApproveConfirmOpen,
    handleBulkApproveRequest,
    handleBulkApproveConfirm,
    handleBulkApproveCancel,
    // 納期超過の下書きを送品済みにする（Issue #367）
    overdueDraftOrders,
    shipOverdueDrafts,
    isShipOverdueDraftsConfirmOpen,
    handleShipOverdueDraftsRequest,
    handleShipOverdueDraftsConfirm,
    handleShipOverdueDraftsCancel,
  }
}

export type OrderBulkActions = ReturnType<typeof useOrderBulkActions>
