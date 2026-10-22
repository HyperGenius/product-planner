"use client"

import { useRouter } from "next/navigation"
import { MoreHorizontal, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { FailedEmailIntakeNotice } from "@/components/orders/intake/failed-email-intake-notice"
import { IntakeCategorySection } from "@/components/orders/intake/intake-category-section"
import { IntakeCategorySummary } from "@/components/orders/intake/intake-category-summary"
import { OrderActionDialogs } from "@/components/orders/order-action-dialogs"
import { OrderBulkActionDialogs } from "@/components/orders/order-bulk-action-dialogs"
import { useOrderActions } from "@/hooks/use-order-actions"
import { useOrderBulkActions } from "@/hooks/use-order-bulk-actions"
import { useOrdersIntake } from "@/hooks/use-orders-intake"
import { INTAKE_CATEGORIES, type IntakeCategory } from "@/lib/order-utils"

/**
 * 起票の確認（Issue #555）
 * URL: /orders/intake
 *
 * 受注担当・ISO担当が、起票された下書きを確認して承認依頼まで進める画面。
 * 下書きを `getIntakeCategory()` の5区分に分け、区分ごとの表で次の操作を出す。
 * 承認依頼を出した注文は下書きでなくなるので、この画面から外れる
 */
export default function OrdersIntakePage() {
  const router = useRouter()
  const {
    orders,
    products,
    customers,
    isLoading,
    ordersByCategory,
    bulkTargetOrders,
    draftCount,
    currentUserRole,
    canShipOverdueDrafts,
  } = useOrdersIntake()
  const actions = useOrderActions(orders)
  const bulk = useOrderBulkActions({
    orders,
    pageOrders: bulkTargetOrders,
    selectionResetKey: "intake",
  })

  const counts = Object.fromEntries(
    INTAKE_CATEGORIES.map((category) => [category, ordersByCategory[category].length])
  ) as Record<IntakeCategory, number>

  return (
    <TooltipProvider>
      <div className={cn("container mx-auto py-6 px-4", bulk.selectedOrderIds.length > 0 && "pb-24")}>
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">起票の確認</h1>
            <p className="text-muted-foreground mt-2">
              起票された下書きを、次に必要な操作ごとに確認して承認依頼まで進めます
            </p>
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

        <FailedEmailIntakeNotice />

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">読み込み中...</div>
        ) : (
          <>
            <IntakeCategorySummary counts={counts} />

            {draftCount === 0 ? (
              <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground shadow-sm">
                確認待ちの下書きはありません
              </div>
            ) : (
              INTAKE_CATEGORIES.filter((category) => counts[category] > 0).map((category) => (
                <IntakeCategorySection
                  key={category}
                  category={category}
                  orders={ordersByCategory[category]}
                  products={products}
                  customers={customers}
                  currentUserRole={currentUserRole}
                  actions={actions}
                  bulk={bulk}
                />
              ))
            )}
          </>
        )}

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
