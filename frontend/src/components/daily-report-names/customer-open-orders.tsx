"use client"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useCustomerOpenOrders } from "@/hooks/use-daily-report-names"
import { formatWorkDate } from "@/lib/daily-report-name-utils"
import { getStatusLabel } from "@/lib/order-utils"
import type { CustomerOpenOrder } from "@/types/daily-report-names"

/** 受注の識別。注文番号が無い取り込み直後の受注は顧客の注文番号、それも無ければ ID */
function orderLabel(order: CustomerOpenOrder): string {
  return order.order_number ?? order.customer_order_no ?? `#${order.order_id}`
}

/**
 * 受注の表。承認前（下書き・承認待ち）の受注には実績が充当されないが、状態の列で分かるので
 * 別のバッジは付けない（その扱いはヘルプに書く。Issue #702）
 */
export function OpenOrdersTable({ orders }: { orders: CustomerOpenOrder[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>注文番号</TableHead>
          <TableHead>製品</TableHead>
          <TableHead className="text-right">数量</TableHead>
          <TableHead className="w-28">希望納期</TableHead>
          <TableHead>状態</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.order_id}>
            <TableCell>{orderLabel(order)}</TableCell>
            <TableCell>{order.product_name}</TableCell>
            <TableCell className="text-right">
              {order.quantity === null ? "－" : order.quantity.toLocaleString()}
            </TableCell>
            <TableCell>{formatWorkDate(order.desired_deadline)}</TableCell>
            <TableCell>{getStatusLabel(order.status)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * 確認ダイアログ: 選んだ製品の、その顧客の確定済み・生産中の受注を出す (Issue #646)。
 * 0件なら何が起きているかを1文で出す（登録自体は止めない。その後の行き先は #706）。
 * 承認前の受注しかないときは、受注が無いときと分けて伝える（Issue #702）
 */
export function ProductOrderStatus({
  customerId,
  productId,
}: {
  customerId: number
  productId: number
}) {
  const { data: orders, isLoading, isError } = useCustomerOpenOrders(customerId)
  if (isLoading) return <p className="text-xs text-muted-foreground">受注を確認中...</p>
  if (isError || !orders) {
    return <p className="text-xs text-muted-foreground">受注の状況を取得できませんでした</p>
  }
  const productOrders = orders.filter((o) => o.product_id === productId)
  const allocatable = productOrders.filter((o) => o.allocatable)
  if (allocatable.length === 0) {
    return (
      <p
        role="alert"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      >
        {productOrders.length > 0
          ? "この顧客のこの製品の受注は承認前です"
          : "この顧客にこの製品の受注がありません"}
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        この製品の受注（{allocatable.length.toLocaleString()}注文）
      </p>
      <div className="max-h-40 overflow-y-auto rounded-md border">
        <OpenOrdersTable orders={allocatable} />
      </div>
    </div>
  )
}
