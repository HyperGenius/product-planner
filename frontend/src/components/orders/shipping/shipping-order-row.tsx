"use client"

import Link from "next/link"
import { Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableCell, TableHead, TableRow } from "@/components/ui/table"
import type { OrderRowActionProps } from "@/hooks/use-order-actions"
import { STATUS_CLASS } from "@/lib/floor-dashboard-utils"
import {
  canShipOrder,
  formatDeadlineDate,
  formatDeadlineShort,
  getCustomerDisplayName,
  getOrderProductDisplayParts,
  isRepairOrder,
  ORDER_TYPE_LABELS,
  getStatusBadgeClass,
  getStatusLabel,
} from "@/lib/order-utils"
import {
  SHIPPING_CANDIDATE_REASONS,
  type ShippingCandidateReason,
  type ShippingRow,
} from "@/lib/shipping-candidate-utils"
import { cn } from "@/lib/utils"
import type { Customer } from "@/types/customer"
import type { MemberRole } from "@/types/member"
import type { Product } from "@/types/product"

const REASON_LABEL: Record<ShippingCandidateReason, string> = {
  final_process_completed: "最終工程完了",
  overdue: "納期超過",
  due_soon: "納期まで1週間",
}

// 納期の理由は納期の状態と同じ色（超過＝赤、間近＝amber）にする
const REASON_CLASS: Record<ShippingCandidateReason, string> = {
  final_process_completed: "bg-green-100 text-green-800 hover:bg-green-100",
  overdue: STATUS_CLASS.overdue,
  due_soon: STATUS_CLASS.due_soon,
}

/** `ShippingOrderRow` の列に対応する見出しの行 */
export function ShippingOrderHeaderRow() {
  return (
    <TableRow>
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>注文番号</span>
          <span className="text-xs font-normal text-muted-foreground">ステータス</span>
        </div>
      </TableHead>
      <TableHead>顧客</TableHead>
      <TableHead>製品</TableHead>
      <TableHead className="text-right">数量</TableHead>
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>納期</span>
          <span className="text-xs font-normal text-muted-foreground">超過／残り日数</span>
        </div>
      </TableHead>
      <TableHead>工程の進捗</TableHead>
      <TableHead>候補の理由</TableHead>
      <TableHead className="text-right text-foreground">操作</TableHead>
    </TableRow>
  )
}

interface ShippingOrderRowProps extends OrderRowActionProps {
  row: ShippingRow
  products?: Product[]
  customers?: Customer[]
  currentUserRole: MemberRole | null
}

function DaysRemainingLabel({ days }: { days: number }) {
  if (days < 0) {
    return <span className="text-xs font-semibold text-destructive">{-days}日超過</span>
  }
  if (days === 0) return <span className="text-xs font-semibold text-amber-600">今日</span>
  return <span className="text-xs text-muted-foreground">残り{days}日</span>
}

/**
 * 「送品の消し込み」画面（Issue #557）の行。社長・受注担当には「送品済みにする」を出し、
 * それ以外のロールは閲覧のみ。一括の送品は作らない（弥生で1件ずつ確認する運用のため）
 */
export function ShippingOrderRow({
  row,
  products,
  customers,
  currentUserRole,
  shipIsPending,
  onShip,
}: ShippingOrderRowProps) {
  const { order, deadline, deadlineSource, daysRemaining, progress, reasons } = row
  const product = getOrderProductDisplayParts(order, products)
  const canShip = canShipOrder(order, currentUserRole)

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col items-start gap-1 leading-tight">
          <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
            {order.order_no ?? order.id}
          </Link>
          <Badge className={cn("text-[10px]", getStatusBadgeClass(order.status))}>
            {getStatusLabel(order.status)}
          </Badge>
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {order.customer_id == null ? "-" : getCustomerDisplayName(order.customer_id, customers)}
      </TableCell>
      <TableCell>
        <div className="flex flex-col leading-tight">
          <span className="inline-flex items-center gap-1.5 text-sm">
            {isRepairOrder(order) && (
              <Badge className="shrink-0 bg-slate-100 text-slate-700 hover:bg-slate-100">
                {ORDER_TYPE_LABELS.repair}
              </Badge>
            )}
            {product.primary}
          </span>
          {product.secondary && (
            <span className="text-xs text-muted-foreground">{product.secondary}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {order.quantity != null ? order.quantity.toLocaleString("ja-JP") : "-"}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-0.5 leading-tight text-sm">
          <span title={formatDeadlineDate(deadline) ?? undefined}>
            {formatDeadlineShort(deadline) ?? "-"}
            {deadlineSource === "effective" && (
              <span className="ml-1 text-xs text-muted-foreground">（完成見込み）</span>
            )}
          </span>
          {daysRemaining !== null && <DaysRemainingLabel days={daysRemaining} />}
        </div>
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {progress ? (
          <span>
            {progress.completedCount} / {progress.totalCount}
            <span className="ml-1 text-xs text-muted-foreground">工程</span>
          </span>
        ) : (
          <span className="text-muted-foreground">日報なし</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {SHIPPING_CANDIDATE_REASONS.filter((r) => reasons.includes(r)).map((reason) => (
            <Badge key={reason} className={REASON_CLASS[reason]}>
              {REASON_LABEL[reason]}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right">
        {canShip && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onShip(order.id, order.order_no ?? "")}
            disabled={shipIsPending}
          >
            <Truck className="mr-1.5 h-3.5 w-3.5" />
            送品済みにする
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
