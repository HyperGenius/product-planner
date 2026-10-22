"use client"

import { MoreHorizontal, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"
import { OrderActionDialogs } from "@/components/orders/order-action-dialogs"
import { OrderBulkActionDialogs } from "@/components/orders/order-bulk-action-dialogs"
import { OrderNotificationCards } from "@/components/orders/order-notification-cards"
import { OrdersFilterBar } from "@/components/orders/orders-filter-bar"
import { OrderTableHeaderRow, OrdersTable } from "@/components/orders/orders-table"
import { OrderTableRow } from "@/components/orders/order-table-row"
import { useOrdersPage, PAGE_SIZE } from "@/hooks/use-orders-page"
import { useOrderActions } from "@/hooks/use-order-actions"
import { useOrderBulkActions } from "@/hooks/use-order-bulk-actions"

export default function OrdersPage() {
  const {
    statusFilter,
    customerFilterId,
    productFilterId,
    sortKey,
    router,
    selectionResetKey,
    isLoading,
    orders,
    products,
    customers,
    draftCount,
    incompleteCount,
    noCustomerCount,
    noDeadlineCount,
    noRoutingCount,
    filteredOrders,
    pagedOrders,
    currentUserRole,
    isPresident,
    canShipOverdueDrafts,
    setParam,
    clearMasterFilters,
  } = useOrdersPage()
  const actions = useOrderActions(orders)
  const bulk = useOrderBulkActions({ orders, pageOrders: pagedOrders, selectionResetKey })

  const selectAll =
    statusFilter === "pending_approval" ? (
      <Checkbox
        checked={
          bulk.allPendingApprovalOnPageSelected
            ? true
            : bulk.somePendingApprovalOnPageSelected
            ? "indeterminate"
            : false
        }
        onCheckedChange={bulk.handleToggleSelectAllPendingApproval}
        disabled={
          !isPresident ||
          bulk.pendingApprovalPageOrders.length === 0 ||
          bulk.isBulkApproving
        }
        aria-label="全選択"
      />
    ) : (
      <Checkbox
        checked={
          bulk.allDraftOnPageSelected
            ? true
            : bulk.someDraftOnPageSelected
            ? "indeterminate"
            : false
        }
        onCheckedChange={bulk.handleToggleSelectAll}
        disabled={
          bulk.draftPageOrders.length === 0 || bulk.isBulkSimulating || bulk.isBulkRequestingApproval
        }
        aria-label="全選択"
      />
    )

  const emptyState =
    statusFilter === "action_required" ? (
      <p>対応が必要な注文はありません</p>
    ) : statusFilter || customerFilterId !== null || productFilterId !== null ? (
      <>
        <p>条件に一致する注文がありません</p>
        {(customerFilterId !== null || productFilterId !== null) && (
          <Button
            variant="outline"
            className="mt-4"
            onClick={clearMasterFilters}
          >
            顧客・製品の絞り込みを解除
          </Button>
        )}
      </>
    ) : (
      <>
        <p>まだ注文がありません</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => router.push("/orders/new")}
        >
          <Plus className="mr-2 h-4 w-4" />
          新規注文を作成
        </Button>
      </>
    )

  return (
    <TooltipProvider>
      <div className={cn("container mx-auto py-6 px-4", bulk.selectedOrderIds.length > 0 && "pb-24")}>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">注文一覧</h1>
            <p className="text-muted-foreground mt-2">登録された注文の一覧を表示します</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => router.push("/orders/new")}>
              <Plus className="mr-2 h-4 w-4" />
              新規注文
            </Button>
            {canShipOverdueDrafts && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">その他の操作</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    disabled={bulk.overdueDraftOrders.length === 0}
                    onClick={bulk.handleShipOverdueDraftsRequest}
                  >
                    納期超過の下書きを送品済みにする
                    {bulk.overdueDraftOrders.length > 0 && `（${bulk.overdueDraftOrders.length}件）`}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {!isLoading && (
          <OrderNotificationCards
            draftCount={draftCount}
            incompleteCount={incompleteCount}
            noCustomerCount={noCustomerCount}
            noDeadlineCount={noDeadlineCount}
            noRoutingCount={noRoutingCount}
            onDraftClick={() => setParam("status", "draft")}
            onIncompleteClick={() => setParam("status", "incomplete")}
          />
        )}

        <OrdersFilterBar
          statusFilter={statusFilter}
          sortKey={sortKey}
          customerFilterId={customerFilterId}
          productFilterId={productFilterId}
          customers={customers}
          products={products}
          onCustomerChange={(v) => setParam("customer", v)}
          onProductChange={(v) => setParam("product", v)}
          onStatusChange={(v) => setParam("status", v)}
          onSortChange={(v) => setParam("sort", v)}
        />

        <OrdersTable
          isLoading={isLoading}
          header={<OrderTableHeaderRow statusFilter={statusFilter} selectAll={selectAll} />}
          rowCount={pagedOrders.length}
          emptyState={emptyState}
          totalCount={filteredOrders.length}
          pageSize={PAGE_SIZE}
        >
          {pagedOrders.map((order) => (
            <OrderTableRow
              key={order.id}
              order={order}
              statusFilter={statusFilter}
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

        <OrderBulkActionDialogs bulk={bulk} products={products} currentUserRole={currentUserRole} />
      </div>
    </TooltipProvider>
  )
}
