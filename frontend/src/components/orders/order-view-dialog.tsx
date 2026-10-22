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
  getProductName,
  getStatusBadgeClass,
  getStatusLabel,
  isDeadlineOverdue,
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
      <ReadOnlyField
        id={fieldId("product")}
        label="製品"
        value={getProductName(order.product_id, products, order.extracted_product_name)}
      />
      <ReadOnlyField
        id={fieldId("customer")}
        label="顧客"
        value={customerName}
        placeholder={customerPlaceholder}
      />
      <ReadOnlyField
        id={fieldId("quantity")}
        label="数量"
        value={order.quantity?.toLocaleString("ja-JP")}
      />
      <ReadOnlyField
        id={fieldId("desired-deadline")}
        label="希望納期"
        value={formatDeadlineDate(order.desired_deadline)}
      />
      <ReadOnlyField
        id={fieldId("scheduling-start-date")}
        label="作業開始日"
        value={formatDeadlineDate(order.scheduling_start_date)}
      />
      <ReadOnlyField
        id={fieldId("deadline")}
        label={usesSimulated ? "シミュ納期" : "確定納期"}
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
