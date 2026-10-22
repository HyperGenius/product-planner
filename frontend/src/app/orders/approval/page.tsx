"use client"

import { Checkbox } from "@/components/ui/checkbox"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  ApprovalOrderHeaderRow,
  ApprovalOrderRow,
} from "@/components/orders/approval/approval-order-row"
import { OrderActionDialogs } from "@/components/orders/order-action-dialogs"
import { OrderBulkActionDialogs } from "@/components/orders/order-bulk-action-dialogs"
import { OrdersTable } from "@/components/orders/orders-table"
import { useOrderActions } from "@/hooks/use-order-actions"
import { useOrderBulkActions } from "@/hooks/use-order-bulk-actions"
import { useOrdersApproval } from "@/hooks/use-orders-approval"

/**
 * 承認（Issue #556）
 * URL: /orders/approval
 *
 * 社長が承認待ちの注文を、希望納期とシミュ納期を見比べながら承認・一括承認・差し戻しする画面。
 * 受注担当は自分たちの依頼を取り下げられ、それ以外のロールは閲覧のみ。
 * 承認・差し戻し・取り下げた注文は承認待ちでなくなるので、この画面から外れる
 */
export default function OrdersApprovalPage() {
  const { orders, products, customers, isLoading, pendingOrders, currentUserRole } =
    useOrdersApproval()
  const actions = useOrderActions(orders)
  const bulk = useOrderBulkActions({
    orders,
    pageOrders: pendingOrders,
    selectionResetKey: "approval",
  })
  const isPresident = currentUserRole === "president"

  const selectAll = isPresident ? (
    <Checkbox
      checked={bulk.getSelectAllState(pendingOrders)}
      onCheckedChange={() => bulk.handleToggleSelectAllOf(pendingOrders)}
      disabled={pendingOrders.length === 0 || bulk.isBulkOperationInProgress}
      aria-label="承認待ちをすべて選択"
    />
  ) : undefined

  return (
    <TooltipProvider>
      <div className={cn("container mx-auto py-6 px-4", bulk.selectedOrderIds.length > 0 && "pb-24")}>
        <div className="mb-6">
          <h1 className="text-3xl font-bold">承認</h1>
          <p className="text-muted-foreground mt-2">
            承認待ちの注文を、承認依頼の古い順に表示します。シミュ納期が希望納期を過ぎている注文は赤く表示します
          </p>
        </div>

        <OrdersTable
          isLoading={isLoading}
          header={<ApprovalOrderHeaderRow selectAll={selectAll} />}
          rowCount={pendingOrders.length}
          emptyState={<p>承認待ちの注文はありません</p>}
        >
          {pendingOrders.map((order) => (
            <ApprovalOrderRow
              key={order.id}
              order={order}
              products={products}
              customers={customers}
              currentUserRole={currentUserRole}
              {...actions.getRowProps(order)}
              {...bulk.getRowProps(order)}
            />
          ))}
        </OrdersTable>

        <OrderActionDialogs
          actions={actions}
          products={products}
          customers={customers}
          currentUserRole={currentUserRole}
        />

        <OrderBulkActionDialogs
          bulk={bulk}
          products={products}
          currentUserRole={currentUserRole}
          showBulkSimulate={false}
        />
      </div>
    </TooltipProvider>
  )
}
