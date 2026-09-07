"use client"

import { AlertCircle, Loader2, Mail, MoreHorizontal, MessageSquareWarning, Truck, Undo2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  getProductName,
  getCustomerName,
  getEffectiveOrderStatus,
  getStatusLabel,
  getStatusBadgeClass,
  getCertaintyLabel,
  getCertaintyBadgeClass,
  formatDeadlineDate,
} from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

interface OrderTableRowProps {
  order: Order
  products?: Product[]
  customers?: Customer[]
  isSimulating: boolean
  hasSimulationError: boolean
  requestApprovalIsPending: boolean
  approveIsPending: boolean
  withdrawIsPending: boolean
  shipIsPending: boolean
  currentUserRole: string | null
  isSelected: boolean
  selectionIndex?: number
  isBulkOperationInProgress: boolean
  hasBulkSimFailed?: boolean
  onSimulate: (order: Order) => void
  onRequestApproval: (order: Order) => void
  onApprove: (order: Order) => void
  onReject: (order: Order) => void
  onWithdraw: (orderId: number, orderNo: string) => void
  onShip: (orderId: number, orderNo: string) => void
  onEdit: (order: Order) => void
  onDelete: (order: Order) => void
  onToggleSelect: (orderId: number) => void
}

export function OrderTableRow({
  order,
  products,
  customers,
  isSimulating,
  hasSimulationError,
  requestApprovalIsPending,
  approveIsPending,
  withdrawIsPending,
  shipIsPending,
  currentUserRole,
  isSelected,
  selectionIndex,
  isBulkOperationInProgress,
  hasBulkSimFailed,
  onSimulate,
  onRequestApproval,
  onApprove,
  onReject,
  onWithdraw,
  onShip,
  onEdit,
  onDelete,
  onToggleSelect,
}: OrderTableRowProps) {
  const router = useRouter()
  const isEmailOrder = order.source_type === "email"
  const effectiveStatus = getEffectiveOrderStatus(order)

  let rowClassName: string | undefined
  if (hasBulkSimFailed) {
    rowClassName = "border-l-[3px] border-l-destructive bg-destructive/5"
  } else if (isEmailOrder) {
    rowClassName = "bg-blue-50/60"
  }

  return (
      <TableRow className={rowClassName}>
        <TableCell className="w-10">
          {order.status === "draft" ||
          (order.status === "pending_approval" && currentUserRole === "president") ? (
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
        <TableCell className="font-medium">
          <div className="flex flex-col gap-1">
            {order.order_no}
            {isEmailOrder && (
              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-blue-100 text-blue-700 w-fit">
                <Mail className="h-3 w-3" />
                自動起票
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {order.customer_order_no ?? "-"}
        </TableCell>
        <TableCell>{getProductName(order.product_id, products, order.extracted_product_name)}</TableCell>
        <TableCell>
          {order.customer_id == null ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-yellow-500 text-sm cursor-default">
                  <AlertCircle className="h-4 w-4" />
                  未設定
                </span>
              </TooltipTrigger>
              <TooltipContent>顧客が設定されていません</TooltipContent>
            </Tooltip>
          ) : (
            getCustomerName(order.customer_id, customers)
          )}
        </TableCell>
        <TableCell className="text-right">{order.quantity}</TableCell>
        <TableCell>
          {order.desired_deadline ? (
            formatDeadlineDate(order.desired_deadline)
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-yellow-500 text-sm cursor-default">
                  <AlertCircle className="h-4 w-4" />
                  未設定
                </span>
              </TooltipTrigger>
              <TooltipContent>希望納期が設定されていません</TooltipContent>
            </Tooltip>
          )}
        </TableCell>
        <TableCell>
          {formatDeadlineDate(order.confirmed_deadline) ?? "-"}
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5">
              {effectiveStatus === "simulated" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge className={getStatusBadgeClass(effectiveStatus)}>
                      {getStatusLabel(effectiveStatus)}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>シミュレーション完了（未確定）</TooltipContent>
                </Tooltip>
              ) : (
                <Badge className={getStatusBadgeClass(effectiveStatus)}>
                  {getStatusLabel(effectiveStatus)}
                </Badge>
              )}
              {order.status === "draft" && order.rejection_reason && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <MessageSquareWarning className="h-4 w-4 text-amber-600 shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs whitespace-pre-wrap">
                    差し戻し理由: {order.rejection_reason}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {order.customer_certainty && (
              <Badge className={getCertaintyBadgeClass(order.customer_certainty)}>
                {getCertaintyLabel(order.customer_certainty)}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-2">
            {hasSimulationError && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertCircle className="h-4 w-4 text-destructive" />
                </TooltipTrigger>
                <TooltipContent>シミュレーションに失敗しました</TooltipContent>
              </Tooltip>
            )}
            {order.status === "draft" && !order.is_scheduled && (
              isEmailOrder ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/orders/${order.id}`)}
                >
                  確認する
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSimulate(order)}
                  disabled={isSimulating || isBulkOperationInProgress}
                >
                  {isSimulating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      実行中...
                    </>
                  ) : (
                    "シミュレーション実行"
                  )}
                </Button>
              )
            )}
            {order.status === "draft" && order.is_scheduled && currentUserRole === "order_handler" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRequestApproval(order)}
                disabled={requestApprovalIsPending || isBulkOperationInProgress}
              >
                承認依頼を送信
              </Button>
            )}
            {order.status === "pending_approval" && currentUserRole === "order_handler" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onWithdraw(order.id, order.order_no ?? "")}
                disabled={withdrawIsPending || isBulkOperationInProgress}
              >
                <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                取り下げ
              </Button>
            )}
            {order.status === "pending_approval" && currentUserRole === "president" && (
              <>
                <Button
                  size="sm"
                  onClick={() => onApprove(order)}
                  disabled={approveIsPending || isBulkOperationInProgress}
                >
                  承認
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onReject(order)}
                  disabled={isBulkOperationInProgress}
                >
                  差し戻し
                </Button>
              </>
            )}
            {order.status === "confirmed" &&
              (currentUserRole === "president" || currentUserRole === "order_handler") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onShip(order.id, order.order_no ?? "")}
                  disabled={shipIsPending || isBulkOperationInProgress}
                >
                  <Truck className="mr-1.5 h-3.5 w-3.5" />
                  送品済みにする
                </Button>
              )}
            {order.status !== "completed" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">メニューを開く</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {order.status === "draft" && order.is_scheduled && (
                    <DropdownMenuItem onClick={() => onSimulate(order)}>
                      再シミュレーション
                    </DropdownMenuItem>
                  )}
                  {order.status === "draft" && (
                    <DropdownMenuItem onClick={() => onEdit(order)}>
                      編集
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onDelete(order)}
                  >
                    削除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </TableCell>
      </TableRow>
  )
}
