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
import { DuplicateOrderDialog } from "@/components/orders/duplicate-order-dialog"
import { ApiError } from "@/lib/api-client"
import { useSplitOrder } from "@/hooks/use-orders"
import {
  isSplitDeadlineMissing,
  isSplitQuantityInvalid,
  validateSplitItems,
} from "@/lib/split-order-validation"
import { cn } from "@/lib/utils"
import type { ConflictingOrder, Order } from "@/types/order"

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
  // 「一度触った項目」だけ赤枠にするための状態（開いた直後にエラー色で埋め尽くさない。Issue #508）
  const [touched, setTouched] = useState<Set<string>>(new Set())
  // 重複起票（顧客×製品×希望納期）を検知した際の通知モーダル状態（Issue #415 PR3）
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const [conflictingOrder, setConflictingOrder] = useState<ConflictingOrder | undefined>()

  // ダイアログを開いた時点の注文内容を初期値として2行を用意する
  useEffect(() => {
    if (open && order) {
      setItems([emptyLineItem(order), emptyLineItem(order)])
      setError("")
      setTouched(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id])

  if (!order) return null

  const validation = validateSplitItems(items)

  const updateItem = (index: number, patch: Partial<SplitLineItemForm>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const markTouched = (index: number, field: string) => {
    setTouched((prev) => new Set(prev).add(`${index}-${field}`))
  }

  const isTouched = (index: number, field: string) => touched.has(`${index}-${field}`)

  const addItem = () => setItems((prev) => [...prev, emptyLineItem(order)])

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setItems([])
      setError("")
      setTouched(new Set())
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = () => {
    setError("")

    if (!validation.ok) {
      setError(validation.message)
      return
    }

    const lineItems = items.map((item) => ({
      product_id: parseInt(item.productId, 10),
      quantity: parseInt(item.quantity, 10),
      desired_deadline: item.desiredDeadline,
      customer_id: item.customerId ? parseInt(item.customerId, 10) : undefined,
    }))

    splitOrder.mutate(
      { id: order.id, data: { line_items: lineItems } },
      {
        onSuccess: () => {
          toast.success(`注文を${lineItems.length}件に分割しました`)
          handleClose(false)
          onSplit?.()
        },
        onError: (err: Error) => {
          if (err instanceof ApiError && err.errorCode === "duplicate_order") {
            setConflictingOrder(err.conflictingOrder)
            setDuplicateDialogOpen(true)
            return
          }
          setError(err.message || "分割に失敗しました")
        },
      }
    )
  }

  return (
    <>
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
                      onBlur={() => markTouched(index, "quantity")}
                      className={cn(
                        isTouched(index, "quantity") &&
                          isSplitQuantityInvalid(item) &&
                          "border-destructive"
                      )}
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
                      onBlur={() => markTouched(index, "deadline")}
                      className={cn(
                        isTouched(index, "deadline") &&
                          isSplitDeadlineMissing(item) &&
                          "border-destructive"
                      )}
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

        <DialogFooter className="flex-col items-end gap-2 border-t px-6 py-4 sm:flex-col">
          {!validation.ok && (
            <p className="text-sm text-muted-foreground">{validation.message}</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleClose(false)}>
              キャンセル
            </Button>
            <Button onClick={handleSubmit} disabled={splitOrder.isPending || !validation.ok}>
              {splitOrder.isPending ? "分割中..." : `${items.length}件に分割する`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <DuplicateOrderDialog
      open={duplicateDialogOpen}
      onOpenChange={setDuplicateDialogOpen}
      conflictingOrder={conflictingOrder}
    />
    </>
  )
}
