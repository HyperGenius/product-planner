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
import type { Order } from "@/types/order"

interface RejectOrderDialogProps {
  order: Order | null
  isPending: boolean
  onConfirm: (reason: string) => void
  onOpenChange: (open: boolean) => void
}

function RejectOrderDialogForm({
  order,
  isPending,
  onConfirm,
  onOpenChange,
}: {
  order: Order
  isPending: boolean
  onConfirm: (reason: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const [reason, setReason] = useState("")

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>受注の却下</DialogTitle>
        <DialogDescription>
          注文「{order.order_no ?? ""}」を却下し、下書きに差し戻します。理由は任意で入力できます。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="reject-reason">却下理由（任意）</Label>
        <textarea
          id="reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          placeholder="修正してほしい内容などを入力してください"
          className={cn(
            "border-input placeholder:text-muted-foreground w-full min-w-0 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow]",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          )}
        />
      </div>
      <DialogFooter>
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
          isPending={isPending}
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
        />
      )}
    </Dialog>
  )
}
