"use client"

import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductSelector } from "@/components/product-selector"
import { CustomerSelector } from "@/components/customer-selector"
import { useUpdateOrder } from "@/hooks/use-orders"
import type { Order } from "@/types/order"

interface EditOrderDialogProps {
  order: Order
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditOrderDialog({ order, open, onOpenChange }: EditOrderDialogProps) {
  const updateOrder = useUpdateOrder()

  const [orderNo, setOrderNo] = useState(order.order_no ?? "")
  const [productId, setProductId] = useState(order.product_id.toString())
  const [customerId, setCustomerId] = useState(order.customer_id?.toString() ?? "")
  const [quantity, setQuantity] = useState(order.quantity.toString())
  const [desiredDeadline, setDesiredDeadline] = useState(
    order.desired_deadline ? order.desired_deadline.slice(0, 16) : ""
  )
  const [duplicateError, setDuplicateError] = useState("")

  const productChanged = productId !== order.product_id.toString()
  const quantityChanged = quantity !== order.quantity.toString()
  const showScheduleWarning = order.is_scheduled && (productChanged || quantityChanged)

  const handleSubmit = () => {
    setDuplicateError("")
    const parsedQuantity = parseInt(quantity, 10)
    if (!productId || isNaN(parsedQuantity) || parsedQuantity <= 0) return

    updateOrder.mutate(
      {
        id: order.id,
        data: {
          order_no: orderNo.trim() || undefined,
          product_id: parseInt(productId, 10),
          customer_id: customerId ? parseInt(customerId, 10) : undefined,
          quantity: parsedQuantity,
          desired_deadline: desiredDeadline || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("注文情報を更新しました")
          onOpenChange(false)
        },
        onError: (error: Error) => {
          if (
            error.message.includes("400") ||
            error.message.toLowerCase().includes("duplicate") ||
            error.message.includes("already")
          ) {
            setDuplicateError("この注文番号はすでに使用されています")
          } else {
            toast.error(`更新に失敗しました: ${error.message}`)
          }
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>注文の編集</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {showScheduleWarning && (
            <div className="flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                スケジュールが無効になります。保存後に再シミュレーションが必要です。
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="order-no">注文番号（任意）</Label>
            <Input
              id="order-no"
              value={orderNo}
              onChange={(e) => {
                setOrderNo(e.target.value)
                setDuplicateError("")
              }}
            />
            {duplicateError && (
              <p className="text-sm text-destructive">{duplicateError}</p>
            )}
          </div>

          <ProductSelector value={productId} onValueChange={setProductId} />

          <CustomerSelector value={customerId} onValueChange={setCustomerId} />

          <div className="space-y-2">
            <Label htmlFor="quantity">数量 *</Label>
            <Input
              id="quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="desired-deadline">希望納期</Label>
            <Input
              id="desired-deadline"
              type="datetime-local"
              value={desiredDeadline}
              onChange={(e) => setDesiredDeadline(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={updateOrder.isPending}>
            {updateOrder.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
