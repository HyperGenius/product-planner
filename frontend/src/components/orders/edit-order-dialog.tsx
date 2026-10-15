"use client"

import { useState } from "react"
import { AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProductSelector } from "@/components/product-selector"
import { CustomerSelector } from "@/components/customer-selector"
import { OrderDialogLayout } from "@/components/orders/order-dialog-layout"
import { DuplicateOrderDialog } from "@/components/orders/duplicate-order-dialog"
import { ApiError } from "@/lib/api-client"
import { useUpdateOrder } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { jstTodayIso, toDateInputValue } from "@/lib/order-utils"
import type { ConflictingOrder, Order } from "@/types/order"

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
  // 重複起票（顧客×製品×希望納期）を検知した際の通知モーダル状態（Issue #415 PR3）
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false)
  const [conflictingOrder, setConflictingOrder] = useState<ConflictingOrder | undefined>()

  if (!order) return null

  // 作業開始日を過去日に設定できるのは president / platform_admin のみ（Issue #372）
  const canBackdateSchedulingStart =
    currentMember?.role === "president" || currentMember?.role === "platform_admin"
  // 過去日判定はバックエンド（JST基準）と揃える（Issue #372）
  const todayStr = jstTodayIso()
  const isSchedulingStartBackdated =
    !!schedulingStartDate && schedulingStartDate < todayStr

  const productChanged = productId !== (order.product_id?.toString() ?? "")
  const quantityChanged = quantity !== (order.quantity?.toString() ?? "")
  const showScheduleWarning = order.is_scheduled && (productChanged || quantityChanged)

  const schedulingStartChanged =
    schedulingStartDate !== toDateInputValue(order.scheduling_start_date)

  const handleSubmit = () => {
    const parsedQuantity = parseInt(quantity, 10)
    if (!productId || isNaN(parsedQuantity) || parsedQuantity <= 0) return

    if (isSchedulingStartBackdated && !canBackdateSchedulingStart) {
      toast.error("作業開始日を過去日に設定できるのは president / platform_admin のみです")
      return
    }

    updateOrder.mutate(
      {
        id: order.id,
        // 空欄にした任意項目（注文番号・希望納期・顧客）は null で送って消す
        // （undefined だとキーごと落ちて更新されないまま成功扱いになる。Issue #518）
        data: {
          order_no: orderNo.trim() || null,
          product_id: parseInt(productId, 10),
          customer_id: customerId ? parseInt(customerId, 10) : null,
          quantity: parsedQuantity,
          desired_deadline: desiredDeadline || null,
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
          // orders の UNIQUE は2本（dedupe_key = 顧客×製品×納期 / 注文番号）。
          // バックエンドが errorCode で振り分けるので、それぞれ実態に合った文言を出す（Issue #415）。
          const errorCode = error instanceof ApiError ? error.errorCode : undefined
          if (errorCode === "duplicate_order_number") {
            toast.error("この注文番号はすでに使用されています")
          } else if (errorCode === "duplicate_order") {
            setConflictingOrder(error instanceof ApiError ? error.conflictingOrder : undefined)
            setDuplicateDialogOpen(true)
          } else {
            toast.error(`更新に失敗しました: ${error.message}`)
          }
        },
      }
    )
  }

  return (
    <>
    <OrderDialogLayout
      order={order}
      open={open}
      onOpenChange={onOpenChange}
      title="注文の編集"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button onClick={handleSubmit} disabled={updateOrder.isPending}>
            {updateOrder.isPending ? "保存中..." : "保存"}
          </Button>
        </>
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
          onChange={(e) => setOrderNo(e.target.value)}
        />
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
    </OrderDialogLayout>
    <DuplicateOrderDialog
      open={duplicateDialogOpen}
      onOpenChange={setDuplicateDialogOpen}
      conflictingOrder={conflictingOrder}
    />
    </>
  )
}
