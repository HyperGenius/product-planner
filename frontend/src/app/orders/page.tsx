"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MasterPagination } from "@/components/master-pagination"
import { EditOrderDialog } from "@/components/orders/edit-order-dialog"
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog"
import { OrderNotificationCards } from "@/components/orders/order-notification-cards"
import { OrdersFilterBar } from "@/components/orders/orders-filter-bar"
import { OrderTableRow } from "@/components/orders/order-table-row"
import { useOrdersPage, PAGE_SIZE } from "@/hooks/use-orders-page"

export default function OrdersPage() {
  const {
    statusFilter,
    sortKey,
    router,
    isLoading,
    products,
    customers,
    draftCount,
    incompleteCount,
    filteredOrders,
    pagedOrders,
    isEditDialogOpen,
    setIsEditDialogOpen,
    selectedOrder,
    deleteTargetOrder,
    setDeleteTargetOrder,
    expandedOrderId,
    expandedSimResult,
    confirmOrder,
    deleteOrder,
    simulateOrderById,
    setParam,
    handleConfirmFromRow,
    handleSimulate,
    handleOpenEditDialog,
    handleConfirmDelete,
    closeSimResult,
  } = useOrdersPage()

  return (
    <TooltipProvider>
      <div className="container mx-auto py-6 px-4">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">注文一覧</h1>
            <p className="text-muted-foreground mt-2">登録された注文の一覧を表示します</p>
          </div>
          <Button onClick={() => router.push("/orders/new")}>
            <Plus className="mr-2 h-4 w-4" />
            新規注文
          </Button>
        </div>

        {!isLoading && (
          <OrderNotificationCards
            draftCount={draftCount}
            incompleteCount={incompleteCount}
            onDraftClick={() => setParam("status", "draft")}
            onIncompleteClick={() => setParam("status", "incomplete")}
          />
        )}

        <OrdersFilterBar
          statusFilter={statusFilter}
          sortKey={sortKey}
          onStatusChange={(v) => setParam("status", v)}
          onSortChange={(v) => setParam("sort", v)}
        />

        <div className="rounded-lg border bg-card shadow-sm">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">読み込み中...</div>
          ) : pagedOrders.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>注文番号</TableHead>
                  <TableHead>製品</TableHead>
                  <TableHead>顧客</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead>希望納期</TableHead>
                  <TableHead>確定納期</TableHead>
                  <TableHead>ステータス</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedOrders.map((order) => (
                  <OrderTableRow
                    key={order.id}
                    order={order}
                    products={products}
                    customers={customers}
                    expandedOrderId={expandedOrderId}
                    expandedSimResult={expandedSimResult}
                    simulateIsPending={simulateOrderById.isPending}
                    confirmIsPending={confirmOrder.isPending}
                    onSimulate={handleSimulate}
                    onConfirm={handleConfirmFromRow}
                    onEdit={handleOpenEditDialog}
                    onDelete={setDeleteTargetOrder}
                    onCloseSimResult={closeSimResult}
                  />
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              {statusFilter ? (
                <p>条件に一致する注文がありません</p>
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
              )}
            </div>
          )}
        </div>

        <MasterPagination totalCount={filteredOrders.length} pageSize={PAGE_SIZE} />

        {selectedOrder && (
          <EditOrderDialog
            order={selectedOrder}
            open={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
          />
        )}

        <DeleteOrderDialog
          order={deleteTargetOrder}
          isPending={deleteOrder.isPending}
          onConfirm={handleConfirmDelete}
          onOpenChange={(open) => { if (!open) setDeleteTargetOrder(null) }}
        />
      </div>
    </TooltipProvider>
  )
}
