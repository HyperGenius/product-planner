"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  useConfirmOrder,
  useDeleteOrder,
  useOrders,
  useSimulateOrderById,
} from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import {
  filterOrder,
  compareOrders,
  DEFAULT_SORT,
  type StatusFilter,
  type SortKey,
} from "@/lib/order-utils"
import type { Order, OrderSimulateResponse, BulkSimulateResult } from "@/types/order"

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
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null)
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null)
  const [expandedSimResult, setExpandedSimResult] = useState<OrderSimulateResponse | null>(null)
  const [simulatingOrderId, setSimulatingOrderId] = useState<number | null>(null)
  const [simulationErrorOrderId, setSimulationErrorOrderId] = useState<number | null>(null)
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([])
  const [isBulkSimulating, setIsBulkSimulating] = useState(false)
  const [isBulkConfirming, setIsBulkConfirming] = useState(false)
  const [isBulkSimulateConfirmOpen, setIsBulkSimulateConfirmOpen] = useState(false)
  const [bulkSimSummary, setBulkSimSummary] = useState<BulkSimulateResult[] | null>(null)
  const [bulkSimFailedIds, setBulkSimFailedIds] = useState<Set<number>>(new Set())

  const queryClient = useQueryClient()

  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const confirmOrder = useConfirmOrder()
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
  const unconfirmedRoutingCount = useMemo(
    () => orders?.filter((o) => o.has_unconfirmed_routings).length ?? 0,
    [orders]
  )

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
  const selectedScheduledCount = useMemo(
    () => selectedOrderIds.filter(
      (id) => orders?.find((o) => o.id === id)?.is_scheduled
    ).length,
    [selectedOrderIds, orders]
  )
  const allDraftOnPageSelected =
    draftPageOrders.length > 0 && draftPageOrders.every((o) => selectedOrderIds.includes(o.id))
  const someDraftOnPageSelected =
    draftPageOrders.some((o) => selectedOrderIds.includes(o.id)) && !allDraftOnPageSelected

  useEffect(() => {
    setSelectedOrderIds([])
    setBulkSimFailedIds(new Set())
  }, [page, statusFilter])

  const handleConfirmFromRow = (orderId: number, orderNo: string) => {
    confirmOrder.mutate(orderId, {
      onSuccess: () => {
        toast.success(`注文「${orderNo}」を確定し、スケジュールを作成しました`)
        setExpandedOrderId(null)
        setExpandedSimResult(null)
      },
      onError: (error: Error) => {
        toast.error(`確定に失敗しました: ${error.message}`)
      },
    })
  }

  const handleSimulate = async (order: Order) => {
    setSimulatingOrderId(order.id)
    setSimulationErrorOrderId(null)
    try {
      const result = await simulateOrderById.mutateAsync(order.id)
      setExpandedOrderId(order.id)
      setExpandedSimResult(result)
    } catch (error) {
      console.error("Simulation error:", error)
      setSimulationErrorOrderId(order.id)
      toast.error("シミュレーションに失敗しました")
    } finally {
      setSimulatingOrderId(null)
    }
  }

  const handleOpenEditDialog = (order: Order) => {
    setSelectedOrder(order)
    setIsEditDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (!deleteTargetOrder) return
    const targetId = deleteTargetOrder.id
    const targetNo = deleteTargetOrder.order_no
    deleteOrder.mutate(targetId, {
      onSuccess: () => {
        toast.success(`注文「${targetNo}」を削除しました`)
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

  const handleBulkConfirmFromSummary = async (orderIds: number[]) => {
    setIsBulkConfirming(true)
    let successCount = 0, failCount = 0
    for (const id of orderIds) {
      try {
        await confirmOrder.mutateAsync(id)
        successCount++
      } catch {
        failCount++
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["orders"] })
    setIsBulkConfirming(false)
    const parts = (
      [
        successCount > 0 ? `成功 ${successCount}件` : null,
        failCount > 0 ? `失敗 ${failCount}件` : null,
      ] as (string | null)[]
    ).filter((p): p is string => p !== null).join(" / ")
    if (failCount === 0) {
      toast.success(`一括確定完了: ${parts}`)
    } else if (successCount === 0) {
      toast.error(`一括確定失敗: ${parts}`)
    } else {
      toast.warning(`一括確定完了: ${parts}`)
    }
  }

  const handleBulkConfirm = async () => {
    const ids = selectedOrderIds
    const scheduledIds = ids.filter((id) => orders?.find((o) => o.id === id)?.is_scheduled)
    const skippedCount = ids.length - scheduledIds.length
    setIsBulkConfirming(true)
    let successCount = 0, failCount = 0
    for (const id of scheduledIds) {
      try {
        await confirmOrder.mutateAsync(id)
        successCount++
      } catch {
        failCount++
      }
    }
    setIsBulkConfirming(false)
    setSelectedOrderIds([])
    const parts = (
      [
        successCount > 0 ? `成功 ${successCount}件` : null,
        failCount > 0 ? `失敗 ${failCount}件` : null,
        skippedCount > 0 ? `スキップ ${skippedCount}件（未スケジュール）` : null,
      ] as (string | null)[]
    ).filter((p): p is string => p !== null).join(" / ")
    if (failCount === 0 && skippedCount === 0) {
      toast.success(`一括確定完了: ${parts}`)
    } else if (successCount === 0 && failCount > 0) {
      toast.error(`一括確定失敗: ${parts}`)
    } else {
      toast.warning(`一括確定完了: ${parts}`)
    }
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
    unconfirmedRoutingCount,
    filteredOrders,
    pagedOrders,
    // Dialog state
    isEditDialogOpen,
    setIsEditDialogOpen,
    selectedOrder,
    deleteTargetOrder,
    setDeleteTargetOrder,
    expandedOrderId,
    expandedSimResult,
    // Mutation state
    confirmOrder,
    deleteOrder,
    simulateOrderById,
    simulatingOrderId,
    simulationErrorOrderId,
    // Handlers
    handleConfirmFromRow,
    handleSimulate,
    handleOpenEditDialog,
    handleConfirmDelete,
    closeSimResult,
    // Bulk selection
    selectedOrderIds,
    selectedScheduledCount,
    draftPageOrders,
    allDraftOnPageSelected,
    someDraftOnPageSelected,
    isBulkSimulating,
    isBulkConfirming,
    isBulkSimulateConfirmOpen,
    handleToggleSelect,
    handleToggleSelectAll,
    handleClearSelection,
    handleBulkSimulateRequest,
    handleBulkSimulateConfirm,
    handleBulkSimulateCancel,
    handleBulkConfirm,
    bulkSimSummary,
    bulkSimFailedIds,
    handleCloseBulkSimSummary,
    handleBulkConfirmFromSummary,
  }
}
