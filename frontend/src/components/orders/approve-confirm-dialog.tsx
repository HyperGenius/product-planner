"use client"

import { buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  getOrderProductName,
  formatDeadlineDate,
  isDeadlineOverdue,
  isRepairOrder,
} from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface ApproveConfirmDialogProps {
  order: Order | null
  products?: Product[]
  isPending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

export function ApproveConfirmDialog({
  order,
  products,
  isPending,
  onConfirm,
  onOpenChange,
}: ApproveConfirmDialogProps) {
  return (
    <AlertDialog
      open={order !== null}
      onOpenChange={(open) => { if (!open) onOpenChange(open) }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>注文の承認</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>
                {order && isRepairOrder(order)
                  ? "この内容で承認しますか？（完了予定日が確定します。スケジュールは作成されません）"
                  : "この内容で承認しますか？（確定後はスケジュールが作成されます）"}
              </p>
              {order && (
                <div className="rounded-md border p-3 text-sm text-foreground space-y-1">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">注文番号</span>
                    <span>{order.order_no ?? "未設定"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">
                      {isRepairOrder(order) ? "件名" : "製品"}
                    </span>
                    <span>{getOrderProductName(order, products)}</span>
                  </div>
                  {isRepairOrder(order) ? (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">実施開始日</span>
                      <span>{formatDeadlineDate(order.scheduling_start_date) ?? "未設定"}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">数量</span>
                      <span>{order.quantity}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">希望納期</span>
                    <span>{formatDeadlineDate(order.desired_deadline) ?? "未設定"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">
                      {isRepairOrder(order) ? "完了予定日" : "シミュ納期"}
                    </span>
                    <span
                      className={
                        isDeadlineOverdue(order, order.simulated_deadline)
                          ? "font-semibold text-destructive"
                          : undefined
                      }
                    >
                      {formatDeadlineDate(order.simulated_deadline) ?? "-"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "default" })}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "処理中..." : "承認する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
