"use client"

import { BulkActionBar } from "@/components/orders/bulk-action-bar"
import { BulkApproveConfirmDialog } from "@/components/orders/bulk-approve-confirm-dialog"
import { BulkRequestApprovalConfirmDialog } from "@/components/orders/bulk-request-approval-confirm-dialog"
import { BulkSimulateConfirmDialog } from "@/components/orders/bulk-simulate-confirm-dialog"
import { BulkSimulateSummaryDialog } from "@/components/orders/bulk-simulate-summary-dialog"
import { ShipOverdueDraftsConfirmDialog } from "@/components/orders/ship-overdue-drafts-confirm-dialog"
import type { OrderBulkActions } from "@/hooks/use-order-bulk-actions"
import type { Product } from "@/types/product"

interface OrderBulkActionDialogsProps {
  bulk: OrderBulkActions
  products?: Product[]
  currentUserRole: string | null
  /** 操作バーに一括シミュレーションを出すか（省略時は出す。Issue #556） */
  showBulkSimulate?: boolean
}

/**
 * 一括操作の操作バーと確認ダイアログ群（`useOrderBulkActions()` の戻り値を受け取って描画する。Issue #554）。
 * 操作バーは選択中だけ画面下部に固定表示されるので、ページ側は選択中に下余白を空けること
 */
export function OrderBulkActionDialogs({
  bulk,
  products,
  currentUserRole,
  showBulkSimulate,
}: OrderBulkActionDialogsProps) {
  return (
    <>
      <BulkActionBar
        selectedCount={bulk.selectedOrderIds.length}
        selectedScheduledCount={bulk.selectedScheduledCount}
        selectedPendingApprovalCount={bulk.selectedPendingApprovalCount}
        currentUserRole={currentUserRole}
        isBulkSimulating={bulk.isBulkSimulating}
        isBulkRequestingApproval={bulk.isBulkRequestingApproval}
        isBulkApproving={bulk.isBulkApproving}
        onBulkSimulate={bulk.handleBulkSimulateRequest}
        onBulkRequestApproval={bulk.handleBulkRequestApprovalRequest}
        onBulkApprove={bulk.handleBulkApproveRequest}
        onClearSelection={bulk.handleClearSelection}
        showBulkSimulate={showBulkSimulate}
      />

      <BulkSimulateConfirmDialog
        open={bulk.isBulkSimulateConfirmOpen}
        orders={bulk.selectedOrders}
        products={products}
        onConfirm={bulk.handleBulkSimulateConfirm}
        onCancel={bulk.handleBulkSimulateCancel}
      />

      <BulkRequestApprovalConfirmDialog
        open={bulk.isBulkRequestApprovalConfirmOpen}
        orders={bulk.selectedScheduledOrders}
        products={products}
        isPending={bulk.isBulkRequestingApproval}
        onConfirm={bulk.handleBulkRequestApprovalConfirm}
        onCancel={bulk.handleBulkRequestApprovalCancel}
      />

      <BulkApproveConfirmDialog
        open={bulk.isBulkApproveConfirmOpen}
        orders={bulk.selectedPendingApprovalOrders}
        products={products}
        isPending={bulk.isBulkApproving}
        onConfirm={bulk.handleBulkApproveConfirm}
        onCancel={bulk.handleBulkApproveCancel}
      />

      <BulkSimulateSummaryDialog
        results={bulk.bulkSimSummary}
        onClose={bulk.handleCloseBulkSimSummary}
        onBulkRequestApproval={bulk.handleBulkRequestApprovalFromSummary}
      />

      <ShipOverdueDraftsConfirmDialog
        open={bulk.isShipOverdueDraftsConfirmOpen}
        orders={bulk.overdueDraftOrders}
        products={products}
        isPending={bulk.shipOverdueDrafts.isPending}
        onConfirm={bulk.handleShipOverdueDraftsConfirm}
        onCancel={bulk.handleShipOverdueDraftsCancel}
      />
    </>
  )
}
