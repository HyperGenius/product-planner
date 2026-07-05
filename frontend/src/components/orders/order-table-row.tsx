"use client"

import { AlertCircle, Loader2, Mail, MoreHorizontal } from "lucide-react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
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
  getStatusLabel,
  getStatusBadgeClass,
  getCertaintyLabel,
  getCertaintyBadgeClass,
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
  confirmIsPending: boolean
  isSelected: boolean
  selectionIndex?: number
  isBulkOperationInProgress: boolean
  hasBulkSimFailed?: boolean
  onSimulate: (order: Order) => void
  onConfirm: (orderId: number, orderNo: string) => void
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
  confirmIsPending,
  isSelected,
  selectionIndex,
  isBulkOperationInProgress,
  hasBulkSimFailed,
  onSimulate,
  onConfirm,
  onEdit,
  onDelete,
  onToggleSelect,
}: OrderTableRowProps) {
  const router = useRouter()
  const isEmailOrder = order.source_type === "email"

  let rowClassName: string | undefined
  if (hasBulkSimFailed) {
    rowClassName = "border-l-[3px] border-l-destructive bg-destructive/5"
  } else if (isEmailOrder) {
    rowClassName = "bg-blue-50/60"
  }

  return (
      <TableRow className={rowClassName}>
        <TableCell className="w-10">
          {order.status === "draft" ? (
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
        <TableCell>{getProductName(order.product_id, products)}</TableCell>
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
            format(new Date(order.desired_deadline), "yyyy/MM/dd HH:mm", { locale: ja })
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
          {order.confirmed_deadline
            ? format(new Date(order.confirmed_deadline), "yyyy/MM/dd", { locale: ja })
            : "-"}
        </TableCell>
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            <Badge className={getStatusBadgeClass(order.status)}>
              {getStatusLabel(order.status)}
            </Badge>
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
            {order.status === "draft" && order.is_scheduled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onConfirm(order.id, order.order_no ?? "")}
                disabled={confirmIsPending || isBulkOperationInProgress}
              >
                確定
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
