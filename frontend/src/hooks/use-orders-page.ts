"use client"

import { useMemo, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
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
  type StatusFilter,
  type SortKey,
} from "@/lib/order-utils"
import type { Order, OrderSimulateResponse } from "@/types/order"

const PAGE_SIZE = 20

export { PAGE_SIZE }

export function useOrdersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const statusFilter = (searchParams.get("status") ?? "") as StatusFilter
  const sortKey = (searchParams.get("sort") ?? "created_at_desc") as SortKey
  const page = Number(searchParams.get("page") ?? "1")

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null)
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null)
  const [expandedSimResult, setExpandedSimResult] = useState<OrderSimulateResponse | null>(null)
  const [simulatingOrderId, setSimulatingOrderId] = useState<number | null>(null)
  const [simulationErrorOrderId, setSimulationErrorOrderId] = useState<number | null>(null)

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
  }
}
