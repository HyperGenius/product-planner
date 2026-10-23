"use client"

import type React from "react"
import { Badge } from "@/components/ui/badge"
import { TableCell, TableHead, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  formatDeadlineDate,
  formatDeadlineShort,
  getCustomerDisplayName,
  getEffectiveOrderStatus,
  getOrderUrgency,
  getRepairSubject,
  getStatusBadgeClass,
  getStatusLabel,
  isDeadlineOverdue,
  ORDER_TYPE_LABELS,
  usesSimulatedDeadlineForOrder,
} from "@/lib/order-utils"
import type { Customer } from "@/types/customer"
import type { Order } from "@/types/order"

/** 修理等の一覧の見出し（Issue #494）。列は `RepairOrderTableRow` に対応する */
export function RepairOrderTableHeaderRow() {
  return (
    <TableRow>
      <TableHead>顧客</TableHead>
      <TableHead>件名</TableHead>
      <TableHead>納期</TableHead>
      <TableHead>実施開始日</TableHead>
      <TableHead>完了予定日</TableHead>
      <TableHead className="text-foreground">ステータス</TableHead>
    </TableRow>
  )
}

interface RepairOrderTableRowProps {
  order: Order
  customers?: Customer[]
  /** 行のクリックで内容の確認モーダルを開く */
  onView: (order: Order) => void
}

/** 修理等の一覧の1行。製品・数量・工程を持たないので、件名と日付だけを出す（Issue #494） */
export function RepairOrderTableRow({ order, customers, onView }: RepairOrderTableRowProps) {
  const effectiveStatus = getEffectiveOrderStatus(order)
  // 承認前は完了予定日（simulated_deadline）、承認後は確定した日（confirmed_deadline）
  const completion = usesSimulatedDeadlineForOrder(order)
    ? order.simulated_deadline
    : order.confirmed_deadline
  const urgency = getOrderUrgency(order, "")

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onView(order)
    }
  }

  return (
    <TableRow
      className={cn(
        "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
        urgency === "today" && "bg-red-50",
        urgency === "this_week" && "bg-amber-50"
      )}
      onClick={() => onView(order)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={`注文 ${order.order_no ?? order.id} の内容を確認`}
    >
      <TableCell className="text-muted-foreground">
        {getCustomerDisplayName(order.customer_id, customers)}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-sm">
          <Badge className="shrink-0 bg-slate-100 text-slate-700 hover:bg-slate-100">
            {ORDER_TYPE_LABELS.repair}
          </Badge>
          <span className="max-w-[320px] truncate" title={getRepairSubject(order)}>
            {getRepairSubject(order)}
          </span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDeadlineShort(order.desired_deadline) ?? "-"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatDeadlineShort(order.scheduling_start_date) ?? "-"}
      </TableCell>
      <TableCell
        className={
          isDeadlineOverdue(order, completion)
            ? "font-semibold text-destructive"
            : "text-muted-foreground"
        }
        title={formatDeadlineDate(completion) ?? undefined}
      >
        {formatDeadlineShort(completion) ?? "-"}
      </TableCell>
      <TableCell>
        <Badge className={getStatusBadgeClass(effectiveStatus)}>
          {getStatusLabel(effectiveStatus)}
        </Badge>
      </TableCell>
    </TableRow>
  )
}
