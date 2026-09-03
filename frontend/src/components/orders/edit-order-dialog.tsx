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
import { SourceEmailPanel } from "@/components/orders/source-email-panel"
import { useUpdateOrder } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { toDateInputValue } from "@/lib/order-utils"
import type { Order } from "@/types/order"

interface EditOrderDialogProps {
  order: Order | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditOrderDialog({ order, open, onOpenChange }: EditOrderDialogProps) {
  const updateOrder = useUpdateOrder()
  const { data: currentMember } = useCurrentMember()

  const [orderNo, setOrderNo] = useState(order?.order_no ?? "")
  const [productId, setProductId] = useState(order?.product_id?.toString() ?? "")
  const [customerId, setCustomerId] = useState(order?.customer_id?.toString() ?? "")
  const [quantity, setQuantity] = useState(order?.quantity?.toString() ?? "")
  const [desiredDeadline, setDesiredDeadline] = useState(toDateInputValue(order?.desired_deadline))
  // 作業開始日（工場が着手する日）。空なら実行日時から着手（Issue #372）
  const [schedulingStartDate, setSchedulingStartDate] = useState(
    toDateInputValue(order?.scheduling_start_date)
  )
  const [duplicateError, setDuplicateError] = useState("")

  if (!order) return null

  // 作業開始日を過去日に設定できるのは president / platform_admin のみ（Issue #372）
  const canBackdateSchedulingStart =
    currentMember?.role === "president" || currentMember?.role === "platform_admin"
  const todayStr = new Date().toLocaleDateString("sv-SE") // YYYY-MM-DD（ローカル日付）
  const isSchedulingStartBackdated =
    !!schedulingStartDate && schedulingStartDate < todayStr

  const hasSourceEmail = order.source_type === "email" && !!order.source_raw
  const productChanged = productId !== (order.product_id?.toString() ?? "")
  const quantityChanged = quantity !== (order.quantity?.toString() ?? "")
  const showScheduleWarning = order.is_scheduled && (productChanged || quantityChanged)

  const schedulingStartChanged =
    schedulingStartDate !== toDateInputValue(order.scheduling_start_date)

  const handleSubmit = () => {
    setDuplicateError("")
    const parsedQuantity = parseInt(quantity, 10)
    if (!productId || isNaN(parsedQuantity) || parsedQuantity <= 0) return

    if (isSchedulingStartBackdated && !canBackdateSchedulingStart) {
      toast.error("作業開始日を過去日に設定できるのは president / platform_admin のみです")
      return
    }

    updateOrder.mutate(
      {
        id: order.id,
        data: {
          order_no: orderNo.trim() || undefined,
          product_id: parseInt(productId, 10),
          customer_id: customerId ? parseInt(customerId, 10) : undefined,
          quantity: parsedQuantity,
          desired_deadline: desiredDeadline || undefined,
          // 変更時のみ送信。クリアした場合は null で解除する
          ...(schedulingStartChanged
            ? { scheduling_start_date: schedulingStartDate || null }
            : {}),
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
      <DialogContent
        className={
          hasSourceEmail
            ? "flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[820px]"
            : "sm:max-w-[480px]"
        }
      >
        <DialogHeader className={hasSourceEmail ? "px-6 pb-4 pt-6" : undefined}>
          <DialogTitle>注文の編集</DialogTitle>
        </DialogHeader>

        <div className={hasSourceEmail ? "flex min-h-0 flex-1 border-t" : undefined}>
          {hasSourceEmail && (
            <SourceEmailPanel
              order={order}
              className="w-[300px] shrink-0 space-y-4 overflow-y-auto border-r bg-muted/30 p-5"
            />
          )}

          <div
            className={
              hasSourceEmail
                ? "flex-1 space-y-4 overflow-y-auto p-5"
                : "space-y-4 py-2"
            }
          >
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
                type="date"
                value={desiredDeadline}
                onChange={(e) => setDesiredDeadline(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scheduling-start-date">作業開始日</Label>
              <Input
                id="scheduling-start-date"
                type="date"
                value={schedulingStartDate}
                min={canBackdateSchedulingStart ? undefined : todayStr}
                onChange={(e) => setSchedulingStartDate(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                工場が着手する日。未設定ならシミュレーション／確定の実行日時から着手します。
              </p>
              {isSchedulingStartBackdated && !canBackdateSchedulingStart && (
                <p className="text-sm text-destructive">
                  過去日を設定できるのは president / platform_admin のみです
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className={hasSourceEmail ? "border-t px-6 py-4" : undefined}>
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
