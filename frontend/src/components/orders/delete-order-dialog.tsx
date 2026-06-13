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
import type { Order } from "@/types/order"

interface DeleteOrderDialogProps {
  order: Order | null
  isPending: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

export function DeleteOrderDialog({ order, isPending, onConfirm, onOpenChange }: DeleteOrderDialogProps) {
  return (
    <AlertDialog
      open={order !== null}
      onOpenChange={(open) => { if (!open) onOpenChange(open) }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>注文の削除</AlertDialogTitle>
          <AlertDialogDescription>
            注文「{order?.order_no}」を削除しますか？この操作は取り消せません。
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
