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
import { getProductName, getCustomerName, formatDeadlineDate } from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

interface DeleteOrderDialogProps {
  order: Order | null
  products?: Product[]
  customers?: Customer[]
  isPending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

export function DeleteOrderDialog({
  order,
  products,
  customers,
  isPending,
  onConfirm,
  onOpenChange,
}: DeleteOrderDialogProps) {
  return (
    <AlertDialog
      open={order !== null}
      onOpenChange={(open) => { if (!open) onOpenChange(open) }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>注文の削除</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>この注文を削除しますか？この操作は取り消せません。</p>
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
                    <span className="text-muted-foreground">顧客</span>
                    <span>{getCustomerName(order.customer_id, customers)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">数量</span>
                    <span>{order.quantity}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">希望納期</span>
                    <span>{formatDeadlineDate(order.desired_deadline) ?? "未設定"}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">確定納期</span>
                    <span>{formatDeadlineDate(order.confirmed_deadline) ?? "-"}</span>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "削除中..." : "削除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
