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
import { getOrderProductName, formatDeadlineDate, isRepairOrder } from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface RequestApprovalConfirmDialogProps {
  order: Order | null
  products?: Product[]
  isPending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

export function RequestApprovalConfirmDialog({
  order,
  products,
  isPending,
  onConfirm,
  onOpenChange,
}: RequestApprovalConfirmDialogProps) {
  return (
    <AlertDialog
      open={order !== null}
      onOpenChange={(open) => { if (!open) onOpenChange(open) }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>承認依頼の送信</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>この内容で承認依頼を送信しますか？</p>
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
                    <>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">実施開始日</span>
                        <span>{formatDeadlineDate(order.scheduling_start_date) ?? "未設定"}</span>
                      </div>
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">完了予定日</span>
                        <span>{formatDeadlineDate(order.simulated_deadline) ?? "未設定"}</span>
                      </div>
                    </>
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
                </div>
              )}
              {order?.rejection_reason && (
                <div className="space-y-1">
                  <p className="text-xs text-amber-800 font-medium">
                    この注文は一度差し戻されています。内容を修正したうえで再送信してください。
                  </p>
                  <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 whitespace-pre-wrap">
                    {order.rejection_reason}
                  </p>
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
            {isPending ? "送信中..." : "承認依頼を送信する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
