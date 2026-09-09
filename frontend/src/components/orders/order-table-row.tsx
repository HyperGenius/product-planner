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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  getProductDisplayParts,
  getCustomerDisplayName,
  getEffectiveOrderStatus,
  getStatusLabel,
  getStatusBadgeClass,
  getCertaintyLabel,
  getCertaintyBadgeClass,
  formatDeadlineDate,
  formatDeadlineShort,
  getDeadlineForTab,
  isDeadlineOverdue,
  type StatusFilter,
} from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

interface OrderTableRowProps {
  order: Order
  /** 現在の一覧タブ。納期カラムを「シミュ納期」/「確定納期」で出し分けるのに使う（Issue #394-B） */
  statusFilter: StatusFilter
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
  statusFilter,
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
  const tabDeadline = getDeadlineForTab(order, statusFilter)
  const tabDeadlineLabel = formatDeadlineDate(tabDeadline)
  const product = getProductDisplayParts(order.product_id, products, order.extracted_product_name)

  // 操作カラムを圧縮するため、主要アクション以外はケバブメニューへ寄せる（Issue #397）
  const canWithdraw = order.status === "pending_approval" && currentUserRole === "order_handler"
  const canReject = order.status === "pending_approval" && currentUserRole === "president"
  const canShip =
    (order.status === "confirmed" || order.status === "in_progress") &&
    (currentUserRole === "president" || currentUserRole === "order_handler")
  const canResimulate = order.status === "draft" && order.is_scheduled
  const canEditOrder = order.status === "draft"
  const hasMenuActionGroup =
    canWithdraw || canReject || canShip || canResimulate || canEditOrder

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
          <div className="flex flex-col gap-0.5 leading-tight">
            <span className="inline-flex items-center gap-1">
              {order.order_no}
              {isEmailOrder && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Mail
                      className="h-3.5 w-3.5 shrink-0 text-blue-600"
                      aria-label="自動起票（メール受信）"
                    />
                  </TooltipTrigger>
                  <TooltipContent>自動起票（メール受信）</TooltipContent>
                </Tooltip>
              )}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {order.customer_order_no ?? "-"}
            </span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col leading-tight">
            <span className="text-sm">{product.primary}</span>
            {product.secondary && (
              <span className="text-xs text-muted-foreground">{product.secondary}</span>
            )}
          </div>
        </TableCell>
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
            getCustomerDisplayName(order.customer_id, customers)
          )}
        </TableCell>
        <TableCell className="text-right">
          {order.quantity != null ? (
            order.quantity.toLocaleString("ja-JP")
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center justify-end gap-1 text-yellow-500 cursor-default">
                  <AlertCircle className="h-3.5 w-3.5" />
                  未設定
                </span>
              </TooltipTrigger>
              <TooltipContent>数量が設定されていません</TooltipContent>
            </Tooltip>
          )}
        </TableCell>
        <TableCell>
          <div className="flex flex-col leading-tight text-sm">
            {order.desired_deadline ? (
              <span
                className="text-muted-foreground"
                title={formatDeadlineDate(order.desired_deadline) ?? undefined}
              >
                {formatDeadlineShort(order.desired_deadline)}
              </span>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-1 text-yellow-500 cursor-default">
                    <AlertCircle className="h-3.5 w-3.5" />
                    未設定
                  </span>
                </TooltipTrigger>
                <TooltipContent>希望納期が設定されていません</TooltipContent>
              </Tooltip>
            )}
            {tabDeadlineLabel ? (
              <span
                className={
                  isDeadlineOverdue(order, tabDeadline)
                    ? "font-semibold text-destructive"
                    : undefined
                }
                title={tabDeadlineLabel ?? undefined}
              >
                {formatDeadlineShort(tabDeadline)}
              </span>
            ) : (
              <span className="text-muted-foreground">-</span>
            )}
          </div>
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
            {order.customer_certainty && order.customer_certainty !== "confirmed" && (
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
                  確認
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
            {order.status === "pending_approval" && currentUserRole === "president" && (
              <Button
                size="sm"
                onClick={() => onApprove(order)}
                disabled={approveIsPending || isBulkOperationInProgress}
              >
                承認
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
                  {canWithdraw && (
                    <DropdownMenuItem
                      onClick={() => onWithdraw(order.id, order.order_no ?? "")}
                      disabled={withdrawIsPending || isBulkOperationInProgress}
                    >
                      <Undo2 className="mr-2 h-3.5 w-3.5" />
                      取り下げ
                    </DropdownMenuItem>
                  )}
                  {canReject && (
                    <DropdownMenuItem
                      onClick={() => onReject(order)}
                      disabled={isBulkOperationInProgress}
                    >
                      <MessageSquareWarning className="mr-2 h-3.5 w-3.5" />
                      差し戻し
                    </DropdownMenuItem>
                  )}
                  {canShip && (
                    <DropdownMenuItem
                      onClick={() => onShip(order.id, order.order_no ?? "")}
                      disabled={shipIsPending || isBulkOperationInProgress}
                    >
                      <Truck className="mr-2 h-3.5 w-3.5" />
                      送品済みにする
                    </DropdownMenuItem>
                  )}
                  {canResimulate && (
                    <DropdownMenuItem onClick={() => onSimulate(order)}>
                      再シミュレーション
                    </DropdownMenuItem>
                  )}
                  {canEditOrder && (
                    <DropdownMenuItem onClick={() => onEdit(order)}>
                      編集
                    </DropdownMenuItem>
                  )}
                  {hasMenuActionGroup && <DropdownMenuSeparator />}
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
