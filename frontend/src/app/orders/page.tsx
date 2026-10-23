"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TooltipProvider } from "@/components/ui/tooltip"
import { OrderActionDialogs } from "@/components/orders/order-action-dialogs"
import { OrdersFilterBar } from "@/components/orders/orders-filter-bar"
import { OrderTableHeaderRow, OrdersTable } from "@/components/orders/orders-table"
import { RepairOrderTableHeaderRow, RepairOrderTableRow } from "@/components/orders/repair-order-table"
import { OrderTableRow, type OrderRowAction } from "@/components/orders/order-table-row"
import { useOrdersPage, PAGE_SIZE } from "@/hooks/use-orders-page"
import { useOrderActions } from "@/hooks/use-order-actions"
import { DEFAULT_ORDER_TYPE_FILTER } from "@/lib/order-utils"

// 作業（シミュ・承認・送品等）は「起票の確認」「承認」「送品の消し込み」の各画面で行うので、
// ここでは行のクリックで内容を確認するだけにする（Issue #558）
const VISIBLE_ACTIONS: readonly OrderRowAction[] = ["view"]

/** すべての注文（全件の検索・履歴。Epic #553） */
export default function OrdersPage() {
  const {
    typeFilter,
    statusFilter,
    customerFilterId,
    productFilterId,
    sortKey,
    router,
    isLoading,
    orders,
    products,
    customers,
    filteredOrders,
    pagedOrders,
    currentUserRole,
    setParam,
    clearMasterFilters,
  } = useOrdersPage()
  const actions = useOrderActions(orders)
  const isRepairList = typeFilter === "repair"

  const emptyState =
    statusFilter || customerFilterId !== null || productFilterId !== null ? (
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
      <div className="container mx-auto py-6 px-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">すべての注文</h1>
            <p className="text-muted-foreground mt-2">登録された注文を検索・確認します</p>
          </div>
          <Button onClick={() => router.push("/orders/new")}>
            <Plus className="mr-2 h-4 w-4" />
            新規注文
          </Button>
        </div>

        <OrdersFilterBar
          typeFilter={typeFilter}
          statusFilter={statusFilter}
          sortKey={sortKey}
          customerFilterId={customerFilterId}
          productFilterId={productFilterId}
          customers={customers}
          products={products}
          onCustomerChange={(v) => setParam("customer", v)}
          onProductChange={(v) => setParam("product", v)}
          onTypeChange={(v) => setParam("type", v === DEFAULT_ORDER_TYPE_FILTER ? "" : v)}
          onStatusChange={(v) => setParam("status", v)}
          onSortChange={(v) => setParam("sort", v)}
        />

        <OrdersTable
          isLoading={isLoading}
          header={
            isRepairList ? (
              <RepairOrderTableHeaderRow />
            ) : (
              <OrderTableHeaderRow statusFilter={statusFilter} showActionColumns={false} />
            )
          }
          rowCount={pagedOrders.length}
          emptyState={emptyState}
          totalCount={filteredOrders.length}
          pageSize={PAGE_SIZE}
        >
          {pagedOrders.map((order) =>
            isRepairList ? (
              <RepairOrderTableRow
                key={order.id}
                order={order}
                customers={customers}
                onView={actions.handleOpenViewDialog}
              />
            ) : (
            <OrderTableRow
              key={order.id}
              order={order}
              statusFilter={statusFilter}
              products={products}
              customers={customers}
              currentUserRole={currentUserRole}
              {...actions.getRowProps(order)}
              visibleActions={VISIBLE_ACTIONS}
              showActionColumns={false}
            />
            )
          )}
        </OrdersTable>

        <OrderActionDialogs
          actions={actions}
          products={products}
          customers={customers}
          currentUserRole={currentUserRole}
        />
      </div>
    </TooltipProvider>
  )
}
