"use client"

import { useId } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OrderDialogLayout } from "@/components/orders/order-dialog-layout"
import { CustomerCertaintyValue } from "@/components/orders/customer-certainty-value"
import { cn } from "@/lib/utils"
import {
  formatDeadlineDate,
  getCustomerName,
  getEffectiveOrderStatus,
  getOrderProductName,
  getStatusBadgeClass,
  getStatusLabel,
  isDeadlineOverdue,
  isRepairOrder,
  ORDER_TYPE_LABELS,
  usesSimulatedDeadlineForOrder,
} from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

interface OrderViewDialogProps {
  order: Order | null
  products?: Product[]
  customers?: Customer[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 注文を読み取り専用で表示するモーダル（Issue #527）。「すべての注文」から全ステータスの注文で開く（Issue #558）。
 * 編集モーダル（EditOrderDialog）と同じ外枠・項目順・入力欄の見た目で、値を変更できない。
 */
export function OrderViewDialog({
  order,
  products,
  customers,
  open,
  onOpenChange,
}: OrderViewDialogProps) {
  const idPrefix = useId()

  if (!order) return null

  const fieldId = (name: string) => `${idPrefix}-${name}`
  const customerName =
    order.customer_id == null ? null : getCustomerName(order.customer_id, customers)
  // メール取り込みで注文書から顧客を特定できなかった受注（Issue #521）
  const customerPlaceholder = order.source_type === "email" ? "顧客不明" : "未設定"
  // 承認前は確定納期が空なので、一覧の納期カラムと同じくシミュ納期を出す
  const usesSimulated = usesSimulatedDeadlineForOrder(order)
  const deadline = usesSimulated ? order.simulated_deadline : order.confirmed_deadline
  const effectiveStatus = getEffectiveOrderStatus(order)
  const isRepair = isRepairOrder(order)

  return (
    <OrderDialogLayout
      order={order}
      open={open}
      onOpenChange={onOpenChange}
      title="注文の確認"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          <Button asChild>
            <Link href={`/orders/${order.id}`}>詳細ページを開く</Link>
          </Button>
        </>
      }
    >
      <ReadOnlyField id={fieldId("order-no")} label="注文番号" value={order.order_no} />
      {isRepair ? (
        <div className="space-y-2">
          <Label htmlFor={fieldId("work-description")} className="flex items-center gap-2">
            件名・作業内容
            <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
              {ORDER_TYPE_LABELS.repair}
            </Badge>
          </Label>
          <textarea
            id={fieldId("work-description")}
            readOnly
            rows={4}
            value={order.work_description ?? ""}
            className="border-input w-full cursor-default resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none"
          />
        </div>
      ) : (
        <ReadOnlyField
          id={fieldId("product")}
          label="製品"
          value={getOrderProductName(order, products)}
        />
      )}
      <ReadOnlyField
        id={fieldId("customer")}
        label="顧客"
        value={customerName}
        placeholder={customerPlaceholder}
      />
      {!isRepair && (
        <ReadOnlyField
          id={fieldId("quantity")}
          label="数量"
          value={order.quantity?.toLocaleString("ja-JP")}
        />
      )}
      <ReadOnlyField
        id={fieldId("desired-deadline")}
        label="希望納期"
        value={formatDeadlineDate(order.desired_deadline)}
      />
      <ReadOnlyField
        id={fieldId("scheduling-start-date")}
        label={isRepair ? "実施開始日" : "作業開始日"}
        value={formatDeadlineDate(order.scheduling_start_date)}
      />
      <ReadOnlyField
        id={fieldId("deadline")}
        label={isRepair ? (usesSimulated ? "完了予定日" : "確定した完了予定日") : usesSimulated ? "シミュ納期" : "確定納期"}
        value={formatDeadlineDate(deadline)}
        inputClassName={
          isDeadlineOverdue(order, deadline)
            ? "font-semibold text-destructive"
            : undefined
        }
      />

      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">ステータス</span>
        <Badge className={getStatusBadgeClass(effectiveStatus)}>
          {getStatusLabel(effectiveStatus)}
        </Badge>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">顧客側の確度</span>
        <CustomerCertaintyValue certainty={order.customer_certainty} />
      </div>
    </OrderDialogLayout>
  )
}

function ReadOnlyField({
  id,
  label,
  value,
  placeholder = "未設定",
  inputClassName,
}: {
  id: string
  label: string
  value: string | null | undefined
  placeholder?: string
  inputClassName?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        readOnly
        value={value ?? ""}
        placeholder={placeholder}
        className={cn("cursor-default", inputClassName)}
      />
    </div>
  )
}
