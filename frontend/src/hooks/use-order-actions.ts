"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  useConfirmOrder,
  useDeleteOrder,
  useRejectOrder,
  useRequestApproval,
  useShipOrder,
  useShipOrderWithoutRouting,
  useSimulateOrderById,
  useWithdrawApproval,
} from "@/hooks/use-orders"
import type { OrderTableRowProps } from "@/components/orders/order-table-row"
import type { Order, OrderSimulateResponse } from "@/types/order"
import { ApiError } from "@/lib/api-client"

/** `OrderTableRow` に渡す行操作の props（`useOrderActions().getRowProps()` の戻り値） */
export type OrderRowActionProps = Pick<
  OrderTableRowProps,
  | "isSimulating"
  | "hasSimulationError"
  | "requestApprovalIsPending"
  | "approveIsPending"
  | "withdrawIsPending"
  | "shipIsPending"
  | "onSimulate"
  | "onRequestApproval"
  | "onApprove"
  | "onReject"
  | "onWithdraw"
  | "onShip"
  | "onShipWithoutRouting"
  | "onEdit"
  | "onDelete"
  | "onView"
>

/**
 * 注文の行操作（シミュ・承認依頼・承認・差し戻し・取り下げ・送品・例外送品・編集・削除・閲覧）の
 * mutation・確認ダイアログの対象・トースト表示をまとめたフック（Issue #554）。
 * 確認ダイアログ群は戻り値をそのまま `OrderActionDialogs` に渡して描画する。
 *
 * @param orders 一覧の注文。閲覧中・シミュ結果表示中の注文を ID から引き直し、再取得（送品済み等）を反映するのに使う
 */
export function useOrderActions(orders: Order[] | undefined) {
  const router = useRouter()

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [editDialogGeneration, setEditDialogGeneration] = useState(0)
  // 確認モーダル（読み取り専用、Issue #527）。一覧の再取得（送品済み等）を反映するため ID で持つ
  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null)
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null)
  const [expandedSimResult, setExpandedSimResult] = useState<OrderSimulateResponse | null>(null)
  const [simulatingOrderId, setSimulatingOrderId] = useState<number | null>(null)
  const [simulationErrorOrderId, setSimulationErrorOrderId] = useState<number | null>(null)
  const [rejectTargetOrder, setRejectTargetOrder] = useState<Order | null>(null)
  const [requestApprovalTargetOrder, setRequestApprovalTargetOrder] = useState<Order | null>(null)
  // 承認依頼の送信に成功した注文。結果モーダル（RequestApprovalResultDialog）表示用（Issue #426）
  const [requestApprovalResultOrder, setRequestApprovalResultOrder] = useState<Order | null>(null)
  const [approveTargetOrder, setApproveTargetOrder] = useState<Order | null>(null)
  const [shipWithoutRoutingTarget, setShipWithoutRoutingTarget] = useState<Order | null>(null)

  const confirmOrder = useConfirmOrder()
  const requestApproval = useRequestApproval()
  const rejectOrder = useRejectOrder()
  const withdrawApproval = useWithdrawApproval()
  const shipOrder = useShipOrder()
  const shipWithoutRouting = useShipOrderWithoutRouting()
  const deleteOrder = useDeleteOrder()
  const simulateOrderById = useSimulateOrderById()

  const viewingOrder = orders?.find((o) => o.id === viewingOrderId) ?? null
  const expandedOrder = orders?.find((o) => o.id === expandedOrderId) ?? null

  const closeSimResult = () => {
    setExpandedOrderId(null)
    setExpandedSimResult(null)
  }

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
        closeSimResult()
      },
      onError: (error: Error) => {
        toast.error(`承認に失敗しました: ${error.message}`)
      },
    })
  }

  const handleRequestApprovalFromRow = (order: Order) => setRequestApprovalTargetOrder(order)

  const handleConfirmRequestApproval = () => {
    if (!requestApprovalTargetOrder) return
    const order = requestApprovalTargetOrder
    requestApproval.mutate(order.id, {
      onSuccess: () => {
        closeSimResult()
        setRequestApprovalTargetOrder(null)
        // トーストではなく結果モーダルで依頼内容（注文番号・顧客・製品・数量・希望納期）を見せる（Issue #426）
        setRequestApprovalResultOrder(order)
      },
      onError: (error: Error) => {
        toast.error(`承認依頼の送信に失敗しました: ${error.message}`)
      },
    })
  }

  const handleWithdrawFromRow = (orderId: number, orderNo: string) => {
    withdrawApproval.mutate(orderId, {
      onSuccess: () => {
        toast.success(`注文「${orderNo}」の承認依頼を取り下げました`)
        closeSimResult()
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

  const handleShipWithoutRoutingRequest = (order: Order) => setShipWithoutRoutingTarget(order)

  const handleShipWithoutRoutingCancel = () => setShipWithoutRoutingTarget(null)

  const handleShipWithoutRoutingConfirm = () => {
    if (!shipWithoutRoutingTarget) return
    const orderNo = shipWithoutRoutingTarget.order_no ?? ""
    shipWithoutRouting.mutate(shipWithoutRoutingTarget.id, {
      onSuccess: () => {
        toast.success(`注文「${orderNo}」を送品済みにしました`)
        setShipWithoutRoutingTarget(null)
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
    setEditingOrder(order)
    setIsEditDialogOpen(true)
    setEditDialogGeneration((prev) => prev + 1)
  }

  const handleOpenViewDialog = (order: Order) => {
    setViewingOrderId(order.id)
    setIsViewDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (!deleteTargetOrder) return
    const targetId = deleteTargetOrder.id
    deleteOrder.mutate(targetId, {
      onSuccess: () => {
        toast.success("注文を削除しました")
        setDeleteTargetOrder(null)
        if (expandedOrderId === targetId) closeSimResult()
      },
      onError: (error: Error) => {
        toast.error(`削除に失敗しました: ${error.message}`)
        setDeleteTargetOrder(null)
      },
    })
  }

  const getRowProps = (order: Order): OrderRowActionProps => ({
    isSimulating: simulatingOrderId === order.id,
    hasSimulationError: simulationErrorOrderId === order.id,
    requestApprovalIsPending: requestApproval.isPending,
    approveIsPending: confirmOrder.isPending,
    withdrawIsPending: withdrawApproval.isPending,
    shipIsPending: shipOrder.isPending || shipWithoutRouting.isPending,
    onSimulate: handleSimulate,
    onRequestApproval: handleRequestApprovalFromRow,
    onApprove: handleApproveFromRow,
    onReject: handleRejectRequest,
    onWithdraw: handleWithdrawFromRow,
    onShip: handleShipFromRow,
    onShipWithoutRouting: handleShipWithoutRoutingRequest,
    onEdit: handleOpenEditDialog,
    onDelete: setDeleteTargetOrder,
    onView: handleOpenViewDialog,
  })

  return {
    getRowProps,
    // Mutation state
    confirmOrder,
    requestApproval,
    rejectOrder,
    withdrawApproval,
    shipOrder,
    shipWithoutRouting,
    deleteOrder,
    // シミュレーション（結果は SimulationSideSheet に出す）
    simulatingOrderId,
    simulationErrorOrderId,
    expandedOrder,
    expandedSimResult,
    handleSimulate,
    closeSimResult,
    // 編集ダイアログ
    editingOrder,
    isEditDialogOpen,
    setIsEditDialogOpen,
    editDialogGeneration,
    handleOpenEditDialog,
    // 確認モーダル（読み取り専用、Issue #527）
    viewingOrder,
    isViewDialogOpen,
    setIsViewDialogOpen,
    handleOpenViewDialog,
    // 削除
    deleteTargetOrder,
    setDeleteTargetOrder,
    handleConfirmDelete,
    // 差し戻し
    rejectTargetOrder,
    setRejectTargetOrder,
    handleRejectRequest,
    handleConfirmReject,
    // 承認依頼の確認モーダル（差し戻し後の再送信確認も統合、Issue #338）
    requestApprovalTargetOrder,
    setRequestApprovalTargetOrder,
    handleRequestApprovalFromRow,
    handleConfirmRequestApproval,
    // 承認依頼 成功結果モーダル（Issue #426）
    requestApprovalResultOrder,
    setRequestApprovalResultOrder,
    // 承認の確認モーダル（Issue #338）
    approveTargetOrder,
    setApproveTargetOrder,
    handleApproveFromRow,
    handleConfirmApprove,
    // 取り下げ・送品
    handleWithdrawFromRow,
    handleShipFromRow,
    // 工程未入力の下書きの例外送品（Issue #547）
    shipWithoutRoutingTarget,
    handleShipWithoutRoutingRequest,
    handleShipWithoutRoutingConfirm,
    handleShipWithoutRoutingCancel,
  }
}

export type OrderActions = ReturnType<typeof useOrderActions>
