"use client"

import { useEffect, useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductSelector } from "@/components/product-selector"
import { CustomerSelector } from "@/components/customer-selector"
import { SourceEmailPanel } from "@/components/orders/source-email-panel"
import { useSplitOrder } from "@/hooks/use-orders"
import type { Order } from "@/types/order"

interface SplitOrderDialogProps {
  order: Order | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSplit?: () => void
}

interface SplitLineItemForm {
  productId: string
  customerId: string
  quantity: string
  desiredDeadline: string
}

function emptyLineItem(order: Order): SplitLineItemForm {
  return {
    productId: order.product_id?.toString() ?? "",
    customerId: order.customer_id?.toString() ?? "",
    quantity: "",
    desiredDeadline: order.desired_deadline ? order.desired_deadline.slice(0, 10) : "",
  }
}

export function SplitOrderDialog({
  order,
  open,
  onOpenChange,
  onSplit,
}: SplitOrderDialogProps) {
  const splitOrder = useSplitOrder()
  const [items, setItems] = useState<SplitLineItemForm[]>([])
  const [error, setError] = useState("")

  // ダイアログを開いた時点の注文内容を初期値として2行を用意する
  useEffect(() => {
    if (open && order) {
      setItems([emptyLineItem(order), emptyLineItem(order)])
      setError("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id])

  if (!order) return null

  const updateItem = (index: number, patch: Partial<SplitLineItemForm>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const addItem = () => setItems((prev) => [...prev, emptyLineItem(order)])

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setItems([])
      setError("")
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = () => {
    setError("")

    if (items.length < 2) {
      setError("分割後の明細は2件以上入力してください")
      return
    }

    const lineItems = []
    for (const item of items) {
      const parsedProductId = parseInt(item.productId, 10)
      const parsedQuantity = parseInt(item.quantity, 10)
      if (!item.productId || isNaN(parsedProductId)) {
        setError("すべての明細で製品を選択してください")
        return
      }
      if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
        setError("すべての明細で数量を正しく入力してください")
        return
      }
      if (!item.desiredDeadline) {
        setError("すべての明細で希望納期を入力してください")
        return
      }
      lineItems.push({
        product_id: parsedProductId,
        quantity: parsedQuantity,
        desired_deadline: item.desiredDeadline,
        customer_id: item.customerId ? parseInt(item.customerId, 10) : undefined,
      })
    }

    splitOrder.mutate(
      { id: order.id, data: { line_items: lineItems } },
      {
        onSuccess: () => {
          toast.success(`注文を${lineItems.length}件に分割しました`)
          handleClose(false)
          onSplit?.()
        },
        onError: (err: Error) => {
          setError(err.message || "分割に失敗しました")
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[960px]">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>注文の分割</DialogTitle>
          <DialogDescription>
            誤って1件にマージされた下書き注文を、複数の下書き注文に分割します。
            分割後の各注文は、元の注文と同じメール／添付ファイルを参照します。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 border-t">
          {/* 左: 参照元メール（分割単位を判断するための情報） */}
          <SourceEmailPanel
            order={order}
            className="w-[300px] shrink-0 space-y-4 overflow-y-auto border-r bg-muted/30 p-5"
          />

          {/* 右: 分割フォーム */}
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {items.map((item, index) => (
              <div key={index} className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">明細 {index + 1}</span>
                  {items.length > 2 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      className="h-7 w-7 p-0 text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <ProductSelector
                  value={item.productId}
                  onValueChange={(value) => updateItem(index, { productId: value })}
                />

                <CustomerSelector
                  value={item.customerId}
                  onValueChange={(value) => updateItem(index, { customerId: value })}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`split-quantity-${index}`}>数量 *</Label>
                    <Input
                      id={`split-quantity-${index}`}
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`split-deadline-${index}`}>希望納期 *</Label>
                    <Input
                      id={`split-deadline-${index}`}
                      type="date"
                      value={item.desiredDeadline}
                      onChange={(e) =>
                        updateItem(index, { desiredDeadline: e.target.value })
                      }
                    />
                  </div>
                </div>
              </div>
            ))}

            <Button variant="outline" size="sm" onClick={addItem} className="w-full">
              <Plus className="mr-2 h-4 w-4" />
              明細を追加
            </Button>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => handleClose(false)}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={splitOrder.isPending}>
            {splitOrder.isPending ? "分割中..." : `${items.length}件に分割する`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
