"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { TooltipProvider } from "@/components/ui/tooltip"
import { MasterPagination } from "@/components/master-pagination"
import { BulkActionBar } from "@/components/orders/bulk-action-bar"
import { BulkSimulateConfirmDialog } from "@/components/orders/bulk-simulate-confirm-dialog"
import { BulkSimulateSummaryDialog } from "@/components/orders/bulk-simulate-summary-dialog"
import { EditOrderDialog } from "@/components/orders/edit-order-dialog"
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog"
import { OrderNotificationCards } from "@/components/orders/order-notification-cards"
import { OrdersFilterBar } from "@/components/orders/orders-filter-bar"
import { OrderTableRow } from "@/components/orders/order-table-row"
import { SimulationSideSheet } from "@/components/orders/simulation-side-sheet"
import { useOrdersPage, PAGE_SIZE } from "@/hooks/use-orders-page"

export default function OrdersPage() {
  const {
    statusFilter,
    sortKey,
    router,
    isLoading,
    orders,
    products,
    customers,
    draftCount,
    incompleteCount,
    noCustomerCount,
    noDeadlineCount,
    filteredOrders,
    pagedOrders,
    isEditDialogOpen,
    setIsEditDialogOpen,
    selectedOrder,
    editDialogGeneration,
    deleteTargetOrder,
    setDeleteTargetOrder,
    expandedOrderId,
    expandedSimResult,
    confirmOrder,
    deleteOrder,
    simulatingOrderId,
    simulationErrorOrderId,
    setParam,
    handleConfirmFromRow,
    handleSimulate,
    handleOpenEditDialog,
    handleConfirmDelete,
    closeSimResult,
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
  } = useOrdersPage()

  const expandedOrder = orders?.find((o) => o.id === expandedOrderId) ?? null

  return (
    <TooltipProvider>
      <div className={cn("container mx-auto py-6 px-4", selectedOrderIds.length > 0 && "pb-24")}>
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
            noCustomerCount={noCustomerCount}
            noDeadlineCount={noDeadlineCount}
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
                  <TableHead className="w-10">
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={
                          allDraftOnPageSelected
                            ? true
                            : someDraftOnPageSelected
                            ? "indeterminate"
                            : false
                        }
                        onCheckedChange={handleToggleSelectAll}
                        disabled={draftPageOrders.length === 0 || isBulkSimulating || isBulkConfirming}
                        aria-label="全選択"
                      />
                    </div>
                  </TableHead>
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
                    isSimulating={simulatingOrderId === order.id}
                    hasSimulationError={simulationErrorOrderId === order.id}
                    confirmIsPending={confirmOrder.isPending}
                    isSelected={selectedOrderIds.includes(order.id)}
                    selectionIndex={selectedOrderIds.includes(order.id) ? selectedOrderIds.indexOf(order.id) + 1 : undefined}
                    isBulkOperationInProgress={isBulkSimulating || isBulkConfirming}
                    hasBulkSimFailed={bulkSimFailedIds.has(order.id)}
                    onSimulate={handleSimulate}
                    onConfirm={handleConfirmFromRow}
                    onEdit={handleOpenEditDialog}
                    onDelete={setDeleteTargetOrder}
                    onToggleSelect={handleToggleSelect}
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
            key={`${selectedOrder.id}-${editDialogGeneration}`}
            order={selectedOrder}
            open={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
          />
        )}

        <DeleteOrderDialog
          order={deleteTargetOrder}
          products={products}
          customers={customers}
          isPending={deleteOrder.isPending}
          onConfirm={handleConfirmDelete}
          onOpenChange={(open) => { if (!open) setDeleteTargetOrder(null) }}
        />

        <SimulationSideSheet
          open={expandedSimResult !== null}
          order={expandedOrder}
          result={expandedSimResult}
          confirmIsPending={confirmOrder.isPending}
          onClose={closeSimResult}
          onConfirm={handleConfirmFromRow}
        />

        <BulkActionBar
          selectedCount={selectedOrderIds.length}
          selectedScheduledCount={selectedScheduledCount}
          isBulkSimulating={isBulkSimulating}
          isBulkConfirming={isBulkConfirming}
          onBulkSimulate={handleBulkSimulateRequest}
          onBulkConfirm={handleBulkConfirm}
          onClearSelection={handleClearSelection}
        />

        <BulkSimulateConfirmDialog
          open={isBulkSimulateConfirmOpen}
          orders={selectedOrderIds
            .map((id) => orders?.find((o) => o.id === id))
            .filter((o): o is NonNullable<typeof o> => o != null)}
          products={products}
          onConfirm={handleBulkSimulateConfirm}
          onCancel={handleBulkSimulateCancel}
        />

        <BulkSimulateSummaryDialog
          results={bulkSimSummary}
          onClose={handleCloseBulkSimSummary}
          onBulkConfirm={handleBulkConfirmFromSummary}
        />
      </div>
    </TooltipProvider>
  )
}
