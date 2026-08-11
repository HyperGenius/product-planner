"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { getProductName, getCustomerName, formatDeadlineDate } from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

interface RejectOrderDialogProps {
  order: Order | null
  products?: Product[]
  customers?: Customer[]
  isPending: boolean
  onConfirm: (reason: string) => void
  onOpenChange: (open: boolean) => void
}

function RejectOrderDialogForm({
  order,
  products,
  customers,
  isPending,
  onConfirm,
  onOpenChange,
}: {
  order: Order
  products?: Product[]
  customers?: Customer[]
  isPending: boolean
  onConfirm: (reason: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState("")

  return (
    <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[720px]">
      <DialogHeader className="px-6 pb-4 pt-6">
        <DialogTitle>受注の却下</DialogTitle>
        <DialogDescription>
          注文「{order.order_no ?? ""}」を却下し、下書きに差し戻します。理由は任意で入力できます。
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 border-t">
        {/* 左: 注文基本情報（却下理由を書く際に注文内容を見返せるようにする） */}
        <div className="w-[280px] shrink-0 space-y-4 overflow-y-auto border-r bg-muted/30 p-5">
          <p className="text-sm font-medium">注文基本情報</p>
          <dl className="space-y-3 text-sm">
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">注文番号</dt>
              <dd className="font-medium">{order.order_no ?? "未設定"}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">製品</dt>
              <dd className="font-medium break-words">
                {getProductName(order.product_id, products, order.extracted_product_name)}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">顧客</dt>
              <dd className="font-medium">
                {order.customer_id ? getCustomerName(order.customer_id, customers) : "未設定"}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">数量</dt>
              <dd className="font-medium">{order.quantity}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted-foreground">希望納期</dt>
              <dd className="font-medium">{formatDeadlineDate(order.desired_deadline) ?? "未設定"}</dd>
            </div>
          </dl>
        </div>

        {/* 右: 却下理由 */}
        <div className="flex flex-1 flex-col gap-2 p-5">
          <Label htmlFor="reject-reason">却下理由（任意）</Label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="修正してほしい内容などを入力してください"
            className={cn(
              "border-input placeholder:text-muted-foreground min-h-0 flex-1 w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] resize-none",
              "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            )}
          />
        </div>
      </div>

      <DialogFooter className="border-t px-6 py-4">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
          キャンセル
        </Button>
        <Button variant="destructive" onClick={() => onConfirm(reason)} disabled={isPending}>
          {isPending ? "却下中..." : "却下する"}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

export function RejectOrderDialog({
  order,
  products,
  customers,
  isPending,
  onConfirm,
  onOpenChange,
}: RejectOrderDialogProps) {
  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => { if (!open) onOpenChange(open) }}
    >
      {order && (
        <RejectOrderDialogForm
          key={order.id}
          order={order}
          products={products}
          customers={customers}
          isPending={isPending}
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
        />
      )}
    </Dialog>
  )
}
