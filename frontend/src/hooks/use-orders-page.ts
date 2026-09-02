"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  useApproveOrdersBulk,
  useConfirmOrder,
  useDeleteOrder,
  useOrders,
  useRejectOrder,
  useRequestApproval,
  useShipOrder,
  useShipOverdueDrafts,
  useSimulateOrderById,
  useWithdrawApproval,
} from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import {
  filterOrder,
  compareOrders,
  isOverdueDraft,
  DEFAULT_SORT,
  type StatusFilter,
  type SortKey,
} from "@/lib/order-utils"
import type { Order, OrderSimulateResponse, BulkSimulateResult } from "@/types/order"
import { ApiError } from "@/lib/api-client"

const PAGE_SIZE = 20

export { PAGE_SIZE }

export function useOrdersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const statusFilter = (searchParams.get("status") ?? "") as StatusFilter
  const sortKey = (searchParams.get("sort") ?? DEFAULT_SORT) as SortKey
  const page = Number(searchParams.get("page") ?? "1")

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [editDialogGeneration, setEditDialogGeneration] = useState(0)
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null)
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null)
  const [expandedSimResult, setExpandedSimResult] = useState<OrderSimulateResponse | null>(null)
  const [simulatingOrderId, setSimulatingOrderId] = useState<number | null>(null)
  const [simulationErrorOrderId, setSimulationErrorOrderId] = useState<number | null>(null)
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([])
  const [isBulkSimulating, setIsBulkSimulating] = useState(false)
  const [isBulkRequestingApproval, setIsBulkRequestingApproval] = useState(false)
  const [isBulkApproving, setIsBulkApproving] = useState(false)
  const [isBulkSimulateConfirmOpen, setIsBulkSimulateConfirmOpen] = useState(false)
  const [bulkSimSummary, setBulkSimSummary] = useState<BulkSimulateResult[] | null>(null)
  const [bulkSimFailedIds, setBulkSimFailedIds] = useState<Set<number>>(new Set())
  const [rejectTargetOrder, setRejectTargetOrder] = useState<Order | null>(null)
  const [requestApprovalTargetOrder, setRequestApprovalTargetOrder] = useState<Order | null>(null)
  const [approveTargetOrder, setApproveTargetOrder] = useState<Order | null>(null)
  const [isBulkRequestApprovalConfirmOpen, setIsBulkRequestApprovalConfirmOpen] = useState(false)
  const [isBulkApproveConfirmOpen, setIsBulkApproveConfirmOpen] = useState(false)
  const [isShipOverdueDraftsConfirmOpen, setIsShipOverdueDraftsConfirmOpen] = useState(false)

  const queryClient = useQueryClient()

  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const { data: currentMember } = useCurrentMember()
  const currentUserRole = currentMember?.role ?? null
  const isPresident = currentUserRole === "president"
  const canShipOverdueDrafts =
    currentUserRole === "president" || currentUserRole === "platform_admin"
  const confirmOrder = useConfirmOrder()
  const requestApproval = useRequestApproval()
  const rejectOrder = useRejectOrder()
  const withdrawApproval = useWithdrawApproval()
  const shipOrder = useShipOrder()
  const shipOverdueDrafts = useShipOverdueDrafts()
  const approveOrdersBulk = useApproveOrdersBulk()
  const deleteOrder = useDeleteOrder()
  const simulateOrderById = useSimulateOrderById()

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    if (key !== "page") params.delete("page")
    router.push(`?${params.toString()}`)
  }

  const draftCount = useMemo(
    () => orders?.filter((o) => o.status === "draft").length ?? 0,
    [orders]
  )
  const incompleteCount = useMemo(
    () => orders?.filter((o) => !o.customer_id || !o.desired_deadline).length ?? 0,
    [orders]
  )
  const noCustomerCount = useMemo(
    () => orders?.filter((o) => !o.customer_id).length ?? 0,
    [orders]
  )
  const noDeadlineCount = useMemo(
    () => orders?.filter((o) => !o.desired_deadline).length ?? 0,
    [orders]
  )
  // 納期を過ぎたまま残っている下書き（president / platform_admin が一括で送品済みにできる）
  const overdueDraftOrders = orders?.filter((o) => isOverdueDraft(o)) ?? []
  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders
      .filter((order) => filterOrder(order, statusFilter))
      .sort((a, b) => compareOrders(a, b, sortKey))
  }, [orders, statusFilter, sortKey])

  const pagedOrders = useMemo(() => {
    const offset = (page - 1) * PAGE_SIZE
    return filteredOrders.slice(offset, offset + PAGE_SIZE)
  }, [filteredOrders, page])

  const draftPageOrders = useMemo(
    () => pagedOrders.filter((o) => o.status === "draft"),
    [pagedOrders]
  )
  const pendingApprovalPageOrders = useMemo(
    () => pagedOrders.filter((o) => o.status === "pending_approval"),
    [pagedOrders]
  )
  const selectedScheduledCount = useMemo(
    () => selectedOrderIds.filter(
      (id) => orders?.find((o) => o.id === id)?.is_scheduled
    ).length,
    [selectedOrderIds, orders]
  )
  const selectedPendingApprovalCount = useMemo(
    () => selectedOrderIds.filter(
      (id) => orders?.find((o) => o.id === id)?.status === "pending_approval"
    ).length,
    [selectedOrderIds, orders]
  )
  const selectedScheduledOrders = useMemo(
    () =>
      selectedOrderIds
        .map((id) => orders?.find((o) => o.id === id))
        .filter((o): o is Order => o != null && o.is_scheduled === true),
    [selectedOrderIds, orders]
  )
  const selectedPendingApprovalOrders = useMemo(
    () =>
      selectedOrderIds
        .map((id) => orders?.find((o) => o.id === id))
        .filter((o): o is Order => o != null && o.status === "pending_approval"),
    [selectedOrderIds, orders]
  )
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
  }, [page, statusFilter])

  // 承認・承認依頼は受注ステータスを不可逆に進める重要な操作のため、
  // 実行前に必ず確認モーダル（ApproveConfirmDialog / RequestApprovalConfirmDialog）を挟む（Issue #338）
  const handleApproveFromRow = (order: Order) => setApproveTargetOrder(order)

  const handleConfirmApprove = () => {
    if (!approveTargetOrder) return
    const orderId = approveTargetOrder.id
    const orderNo = approveTargetOrder.order_no ?? ""
    confirmOrder.mutate(orderId, {
      onSuccess: () => {
        toast.success(`注文「${orderNo}」を承認し、スケジュールを作成しました`)
        setApproveTargetOrder(null)
        setExpandedOrderId(null)
        setExpandedSimResult(null)
      },
      onError: (error: Error) => {
        toast.error(`承認に失敗しました: ${error.message}`)
      },
    })
  }

  const submitRequestApproval = (orderId: number, orderNo: string) => {
    requestApproval.mutate(orderId, {
      onSuccess: () => {
        toast.success(`注文「${orderNo}」の承認依頼を送信しました`)
        setExpandedOrderId(null)
        setExpandedSimResult(null)
        setRequestApprovalTargetOrder(null)
      },
      onError: (error: Error) => {
        toast.error(`承認依頼の送信に失敗しました: ${error.message}`)
      },
    })
  }

  const handleRequestApprovalFromRow = (order: Order) => setRequestApprovalTargetOrder(order)

  const handleConfirmRequestApproval = () => {
    if (!requestApprovalTargetOrder) return
    submitRequestApproval(requestApprovalTargetOrder.id, requestApprovalTargetOrder.order_no ?? "")
  }

  const handleWithdrawFromRow = (orderId: number, orderNo: string) => {
    withdrawApproval.mutate(orderId, {
      onSuccess: () => {
        toast.success(`注文「${orderNo}」の承認依頼を取り下げました`)
        setExpandedOrderId(null)
        setExpandedSimResult(null)
      },
      onError: (error: Error) => {
        toast.error(`承認依頼の取り下げに失敗しました: ${error.message}`)
      },
    })
  }

  const handleShipFromRow = (orderId: number, orderNo: string) => {
    shipOrder.mutate(orderId, {
      onSuccess: () => {
        toast.success(`注文「${orderNo}」を送品済みにしました`)
      },
      onError: (error: Error) => {
        toast.error(`送品済みへの変更に失敗しました: ${error.message}`)
      },
    })
  }

  const handleRejectRequest = (order: Order) => setRejectTargetOrder(order)

  const handleConfirmReject = (reason: string) => {
    if (!rejectTargetOrder) return
    const targetId = rejectTargetOrder.id
    const orderNo = rejectTargetOrder.order_no ?? ""
    rejectOrder.mutate(
      { id: targetId, reason: reason || undefined },
      {
        onSuccess: () => {
          toast.success(`注文「${orderNo}」を差し戻しました`)
          setRejectTargetOrder(null)
        },
        onError: (error: Error) => {
          toast.error(`差し戻しに失敗しました: ${error.message}`)
        },
      }
    )
  }

  const handleSimulate = async (order: Order) => {
    setSimulatingOrderId(order.id)
    setSimulationErrorOrderId(null)
    try {
      const result = await simulateOrderById.mutateAsync(order.id)
      setExpandedOrderId(order.id)
      setExpandedSimResult(result)
    } catch (error) {
      setSimulationErrorOrderId(order.id)
      if (error instanceof ApiError && error.status === 422 && error.errorCode === "no_routing") {
        toast.error("工程が設定されていないため、シミュレーションを実行できません。", {
          description: "製品マスタから工程を設定してください。",
          action: {
            label: "工程を設定する",
            onClick: () => router.push("/master/products"),
          },
        })
      } else {
        toast.error("シミュレーションに失敗しました")
      }
    } finally {
      setSimulatingOrderId(null)
    }
  }

  const handleOpenEditDialog = (order: Order) => {
    setSelectedOrder(order)
    setIsEditDialogOpen(true)
    setEditDialogGeneration((prev) => prev + 1)
  }

  const handleConfirmDelete = () => {
    if (!deleteTargetOrder) return
    const targetId = deleteTargetOrder.id
    deleteOrder.mutate(targetId, {
      onSuccess: () => {
        toast.success("注文を削除しました")
        setDeleteTargetOrder(null)
        if (expandedOrderId === targetId) {
          setExpandedOrderId(null)
          setExpandedSimResult(null)
        }
      },
      onError: (error: Error) => {
        toast.error(`削除に失敗しました: ${error.message}`)
        setDeleteTargetOrder(null)
      },
    })
  }

  const closeSimResult = () => {
    setExpandedOrderId(null)
    setExpandedSimResult(null)
  }

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

  return {
    // URL state
    statusFilter,
    sortKey,
    page,
    setParam,
    router,
    // Data
    orders,
    products,
    customers,
    isLoading: ordersLoading || productsLoading || customersLoading,
    // Derived
    draftCount,
    incompleteCount,
    noCustomerCount,
    noDeadlineCount,
    filteredOrders,
    pagedOrders,
    // Dialog state
    isEditDialogOpen,
    setIsEditDialogOpen,
    selectedOrder,
    editDialogGeneration,
    deleteTargetOrder,
    setDeleteTargetOrder,
    expandedOrderId,
    expandedSimResult,
    // Role
    currentUserRole,
    isPresident,
    canShipOverdueDrafts,
    // Mutation state
    confirmOrder,
    requestApproval,
    rejectOrder,
    withdrawApproval,
    shipOrder,
    shipOverdueDrafts,
    deleteOrder,
    simulateOrderById,
    simulatingOrderId,
    simulationErrorOrderId,
    // Handlers
    handleApproveFromRow,
    handleRequestApprovalFromRow,
    handleWithdrawFromRow,
    handleShipFromRow,
    handleRejectRequest,
    handleConfirmReject,
    handleSimulate,
    handleOpenEditDialog,
    handleConfirmDelete,
    closeSimResult,
    // Reject dialog state
    rejectTargetOrder,
    setRejectTargetOrder,
    // Request approval confirmation dialog state（差し戻し後の再送信確認も統合、Issue #338）
    requestApprovalTargetOrder,
    setRequestApprovalTargetOrder,
    handleConfirmRequestApproval,
    // Approve confirmation dialog state（Issue #338）
    approveTargetOrder,
    setApproveTargetOrder,
    handleConfirmApprove,
    // Bulk selection
    selectedOrderIds,
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
    isBulkSimulating,
    isBulkRequestingApproval,
    isBulkApproving,
    isBulkSimulateConfirmOpen,
    isBulkRequestApprovalConfirmOpen,
    isBulkApproveConfirmOpen,
    handleToggleSelect,
    handleToggleSelectAll,
    handleToggleSelectAllPendingApproval,
    handleClearSelection,
    handleBulkSimulateRequest,
    handleBulkSimulateConfirm,
    handleBulkSimulateCancel,
    handleBulkRequestApprovalRequest,
    handleBulkRequestApprovalConfirm,
    handleBulkRequestApprovalCancel,
    handleBulkApproveRequest,
    handleBulkApproveConfirm,
    handleBulkApproveCancel,
    bulkSimSummary,
    bulkSimFailedIds,
    handleCloseBulkSimSummary,
    handleBulkRequestApprovalFromSummary,
    // 納期超過の下書きを送品済みにする（Issue #367）
    overdueDraftOrders,
    isShipOverdueDraftsConfirmOpen,
    handleShipOverdueDraftsRequest,
    handleShipOverdueDraftsConfirm,
    handleShipOverdueDraftsCancel,
  }
}
