"use client"

import { ApproveConfirmDialog } from "@/components/orders/approve-confirm-dialog"
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog"
import { EditOrderDialog } from "@/components/orders/edit-order-dialog"
import { OrderViewDialog } from "@/components/orders/order-view-dialog"
import { RejectOrderDialog } from "@/components/orders/reject-order-dialog"
import { RequestApprovalConfirmDialog } from "@/components/orders/request-approval-confirm-dialog"
import { RequestApprovalResultDialog } from "@/components/orders/request-approval-result-dialog"
import { ShipWithoutRoutingConfirmDialog } from "@/components/orders/ship-without-routing-confirm-dialog"
import { SimulationSideSheet } from "@/components/orders/simulation-side-sheet"
import type { OrderActions } from "@/hooks/use-order-actions"
import type { Customer } from "@/types/customer"
import type { Product } from "@/types/product"

interface OrderActionDialogsProps {
  actions: OrderActions
  products?: Product[]
  customers?: Customer[]
  currentUserRole: string | null
}

/** 行操作の確認ダイアログ群（`useOrderActions()` の戻り値を受け取って描画する。Issue #554） */
export function OrderActionDialogs({
  actions,
  products,
  customers,
  currentUserRole,
}: OrderActionDialogsProps) {
  return (
    <>
      {actions.editingOrder && (
        <EditOrderDialog
          key={`${actions.editingOrder.id}-${actions.editDialogGeneration}`}
          order={actions.editingOrder}
          open={actions.isEditDialogOpen}
          onOpenChange={actions.setIsEditDialogOpen}
        />
      )}

      <OrderViewDialog
        order={actions.viewingOrder}
        products={products}
        customers={customers}
        open={actions.isViewDialogOpen}
        onOpenChange={actions.setIsViewDialogOpen}
      />

      <DeleteOrderDialog
        order={actions.deleteTargetOrder}
        products={products}
        customers={customers}
        isPending={actions.deleteOrder.isPending}
        onConfirm={actions.handleConfirmDelete}
        onOpenChange={(open) => { if (!open) actions.setDeleteTargetOrder(null) }}
      />

      <RejectOrderDialog
        order={actions.rejectTargetOrder}
        products={products}
        customers={customers}
        isPending={actions.rejectOrder.isPending}
        onConfirm={actions.handleConfirmReject}
        onOpenChange={(open) => { if (!open) actions.setRejectTargetOrder(null) }}
      />

      <RequestApprovalConfirmDialog
        order={actions.requestApprovalTargetOrder}
        products={products}
        isPending={actions.requestApproval.isPending}
        onConfirm={actions.handleConfirmRequestApproval}
        onOpenChange={(open) => { if (!open) actions.setRequestApprovalTargetOrder(null) }}
      />

      <RequestApprovalResultDialog
        order={actions.requestApprovalResultOrder}
        products={products}
        customers={customers}
        onOpenChange={(open) => { if (!open) actions.setRequestApprovalResultOrder(null) }}
      />

      <ApproveConfirmDialog
        order={actions.approveTargetOrder}
        products={products}
        isPending={actions.confirmOrder.isPending}
        onConfirm={actions.handleConfirmApprove}
        onOpenChange={(open) => { if (!open) actions.setApproveTargetOrder(null) }}
      />

      <SimulationSideSheet
        open={actions.expandedSimResult !== null}
        order={actions.expandedOrder}
        result={actions.expandedSimResult}
        requestApprovalIsPending={actions.requestApproval.isPending}
        currentUserRole={currentUserRole}
        onClose={actions.closeSimResult}
        onRequestApproval={actions.handleRequestApprovalFromRow}
      />

      <ShipWithoutRoutingConfirmDialog
        open={actions.shipWithoutRoutingTarget !== null}
        orderNo={actions.shipWithoutRoutingTarget?.order_no ?? ""}
        isPending={actions.shipWithoutRouting.isPending}
        onConfirm={actions.handleShipWithoutRoutingConfirm}
        onCancel={actions.handleShipWithoutRoutingCancel}
      />
    </>
  )
}
