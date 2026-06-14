"use client"

import { AlertCircle, Loader2, MoreHorizontal } from "lucide-react"
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
  return (
      <TableRow className={hasBulkSimFailed ? "border-l-[3px] border-l-destructive bg-destructive/5" : undefined}>
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
        <TableCell className="font-medium">{order.order_no}</TableCell>
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
          <Badge className={getStatusBadgeClass(order.status)}>
            {getStatusLabel(order.status)}
          </Badge>
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
            )}
            {order.status === "draft" && order.is_scheduled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onConfirm(order.id, order.order_no)}
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
