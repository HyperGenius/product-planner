"use client"

import { Badge } from "@/components/ui/badge"
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

/** 受注の表。割り付けの候補でない受注（下書き・承認待ち）には実績が充当されないことを併記する */
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
            <TableCell className="space-x-1">
              <span>{getStatusLabel(order.status)}</span>
              {!order.allocatable && (
                <Badge variant="outline" className="text-xs font-normal">
                  割り付け対象外
                </Badge>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * 行の展開部: 顧客先が照合済みの製品の行に、その顧客の未出荷の受注を一覧で見せる (Issue #646)。
 * 類似度の低い候補しかないとき、人が見て対応付け先を選ぶための材料。表示だけで自動確定はしない。
 */
export function CustomerOpenOrdersPanel({ customerId }: { customerId: number }) {
  const { data: orders, isLoading, isError } = useCustomerOpenOrders(customerId)
  return (
    <div className="space-y-1 border-t">
      <p className="px-3 pt-2 text-xs font-medium text-muted-foreground">
        この顧客の未出荷の受注
        {orders && `（${orders.length} 件）`}
      </p>
      {isLoading ? (
        <p className="px-3 pb-2 text-sm text-muted-foreground">読み込み中...</p>
      ) : isError || !orders ? (
        <p className="px-3 pb-2 text-sm text-destructive">受注を取得できませんでした</p>
      ) : orders.length === 0 ? (
        <p className="px-3 pb-2 text-sm text-muted-foreground">未出荷の受注はありません</p>
      ) : (
        <div className="max-h-60 overflow-y-auto">
          <OpenOrdersTable orders={orders} />
        </div>
      )}
    </div>
  )
}

/**
 * 確認ダイアログ: 選んだ製品の、その顧客の割り付け対象の受注を出す (Issue #646)。
 * 0件なら、登録しても実績は未割当に残ることを警告する（登録自体は止めない）。
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
  const allocatable = orders.filter((o) => o.product_id === productId && o.allocatable)
  return <AllocatableOrders orders={allocatable} />
}

function AllocatableOrders({ orders }: { orders: CustomerOpenOrder[] }) {
  if (orders.length === 0) {
    return (
      <p
        role="alert"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      >
        この顧客に、この製品の確定済み・生産中の受注がありません。割り付け先がないため、実績は未割当に残ります。
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">割り付け先の受注（{orders.length} 件）</p>
      <div className="max-h-40 overflow-y-auto rounded-md border">
        <OpenOrdersTable orders={orders} />
      </div>
    </div>
  )
}
