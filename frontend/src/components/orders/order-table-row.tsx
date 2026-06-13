"use client"

import { Fragment } from "react"
import { AlertCircle, MoreHorizontal } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { SimulationResult } from "@/components/simulation-result"
import {
  getProductName,
  getCustomerName,
  getStatusLabel,
  getStatusBadgeClass,
} from "@/lib/order-utils"
import type { Order, OrderSimulateResponse } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

interface OrderTableRowProps {
  order: Order
  products?: Product[]
  customers?: Customer[]
  expandedOrderId: number | null
  expandedSimResult: OrderSimulateResponse | null
  simulateIsPending: boolean
  confirmIsPending: boolean
  onSimulate: (order: Order) => void
  onConfirm: (orderId: number, orderNo: string) => void
  onEdit: (order: Order) => void
  onDelete: (order: Order) => void
  onCloseSimResult: () => void
}

export function OrderTableRow({
  order,
  products,
  customers,
  expandedOrderId,
  expandedSimResult,
  simulateIsPending,
  confirmIsPending,
  onSimulate,
  onConfirm,
  onEdit,
  onDelete,
  onCloseSimResult,
}: OrderTableRowProps) {
  const isExpanded = expandedOrderId === order.id

  return (
    <Fragment key={order.id}>
      <TableRow>
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
            {order.status === "draft" && !order.is_scheduled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSimulate(order)}
                disabled={simulateIsPending}
              >
                シミュレーション実行
              </Button>
            )}
            {order.status === "draft" && order.is_scheduled && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onConfirm(order.id, order.order_no)}
                disabled={confirmIsPending}
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
      {isExpanded && expandedSimResult && (
        <TableRow key={`${order.id}-sim`}>
          <TableCell colSpan={8} className="bg-muted/30 p-4">
            <SimulationResult
              result={expandedSimResult}
              desiredDeadline={order.desired_deadline}
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={onCloseSimResult}>
                閉じる
              </Button>
              <Button
                size="sm"
                onClick={() => onConfirm(order.id, order.order_no)}
                disabled={confirmIsPending}
              >
                この内容で確定
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}
