"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { AlertTriangle, MessageSquareWarning, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { TableCell, TableHead, TableRow } from "@/components/ui/table"
import type { OrderRowActionProps } from "@/hooks/use-order-actions"
import type { OrderRowBulkProps } from "@/hooks/use-order-bulk-actions"
import { getSimulatedDeadlineDiffDays } from "@/lib/deadline-risk"
import {
  canApproveOrder,
  canRejectOrder,
  canWithdrawApproval,
  formatDateTimeShort,
  formatDeadlineDate,
  formatDeadlineShort,
  getCustomerDisplayName,
  getOrderProductDisplayParts,
  isRepairOrder,
  ORDER_TYPE_LABELS,
} from "@/lib/order-utils"
import { cn } from "@/lib/utils"
import type { Customer } from "@/types/customer"
import type { MemberRole } from "@/types/member"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface ApprovalOrderHeaderRowProps {
  /** 選択列の見出し（社長の全選択のチェックボックス） */
  selectAll?: ReactNode
}

/** `ApprovalOrderRow` の列に対応する見出しの行 */
export function ApprovalOrderHeaderRow({ selectAll }: ApprovalOrderHeaderRowProps) {
  return (
    <TableRow>
      <TableHead className="w-10">
        <div className="flex items-center justify-center">{selectAll}</div>
      </TableHead>
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>注文番号</span>
          <span className="text-xs font-normal text-muted-foreground">顧客注番</span>
        </div>
      </TableHead>
      <TableHead>顧客</TableHead>
      <TableHead>製品</TableHead>
      <TableHead className="text-right">数量</TableHead>
      <TableHead>希望納期</TableHead>
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>シミュ納期</span>
          <span className="text-xs font-normal text-muted-foreground">希望納期との差</span>
        </div>
      </TableHead>
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>依頼者</span>
          <span className="text-xs font-normal text-muted-foreground">依頼日時</span>
        </div>
      </TableHead>
      <TableHead className="text-right text-foreground">操作</TableHead>
    </TableRow>
  )
}

interface ApprovalOrderRowProps extends OrderRowActionProps, OrderRowBulkProps {
  order: Order
  products?: Product[]
  customers?: Customer[]
  currentUserRole: MemberRole | null
}

/**
 * 「承認」画面（Issue #556）の承認待ちの行。社長には承認・差し戻しと一括承認の選択、
 * 受注担当には取り下げを出し、それ以外のロールは閲覧のみ。
 * 操作の可否は注文一覧（`OrderTableRow`）と同じ `canApproveOrder()` 等で判定する
 */
export function ApprovalOrderRow({
  order,
  products,
  customers,
  currentUserRole,
  approveIsPending,
  withdrawIsPending,
  onApprove,
  onReject,
  onWithdraw,
  isSelected,
  selectionIndex,
  isBulkOperationInProgress,
  onToggleSelect,
}: ApprovalOrderRowProps) {
  const product = getOrderProductDisplayParts(order, products)
  const diffDays = getSimulatedDeadlineDiffDays(order)
  const isOverrun = diffDays !== null && diffDays > 0
  const canApprove = canApproveOrder(order, currentUserRole)
  const canReject = canRejectOrder(order, currentUserRole)
  const canWithdraw = canWithdrawApproval(order, currentUserRole)
  const requestedAt = formatDateTimeShort(order.approval_requested_at)

  return (
    <TableRow className={cn(isOverrun && "bg-red-50")}>
      <TableCell className="w-10">
        {canApprove ? (
          <div className="relative flex items-center justify-center">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(order.id)}
              disabled={isBulkOperationInProgress}
              aria-label={`注文 ${order.order_no} を選択`}
            />
            {selectionIndex != null && (
              <Badge className="absolute -top-2 -right-2 h-4 w-4 p-0 text-[10px] flex items-center justify-center rounded-full">
                {selectionIndex}
              </Badge>
            )}
          </div>
        ) : null}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5 leading-tight">
          <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
            {order.order_no ?? order.id}
          </Link>
          <span className="text-xs text-muted-foreground">{order.customer_order_no ?? "-"}</span>
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
      <TableCell className="text-sm" title={formatDeadlineDate(order.desired_deadline) ?? undefined}>
        {formatDeadlineShort(order.desired_deadline) ?? "-"}
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-0.5 leading-tight text-sm">
          <span title={formatDeadlineDate(order.simulated_deadline) ?? undefined}>
            {formatDeadlineShort(order.simulated_deadline) ?? "-"}
          </span>
          {isOverrun ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {diffDays}日超過
            </span>
          ) : diffDays === 0 ? (
            <span className="text-xs text-muted-foreground">希望納期どおり</span>
          ) : diffDays !== null ? (
            <span className="text-xs text-muted-foreground">{-diffDays}日前</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col leading-tight text-sm">
          <span>{order.approval_requested_by_name ?? "-"}</span>
          <span className="text-xs text-muted-foreground">{requestedAt ?? "-"}</span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {canReject && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReject(order)}
              disabled={isBulkOperationInProgress}
            >
              <MessageSquareWarning className="mr-1.5 h-3.5 w-3.5" />
              差し戻し
            </Button>
          )}
          {canApprove && (
            <Button
              size="sm"
              onClick={() => onApprove(order)}
              disabled={approveIsPending || isBulkOperationInProgress}
            >
              承認
            </Button>
          )}
          {canWithdraw && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onWithdraw(order.id, order.order_no ?? "")}
              disabled={withdrawIsPending}
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              取り下げ
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
