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
import { getProductName, formatDeadlineDate } from "@/lib/order-utils"
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
                    <span className="text-muted-foreground">製品</span>
                    <span>{getProductName(order.product_id, products, order.extracted_product_name)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">数量</span>
                    <span>{order.quantity}</span>
                  </div>
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
              <p className="text-xs text-muted-foreground">
                承認者（president）に通知が送信されます。
              </p>
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
