"use client"

import { useMemo } from "react"
import { OrdersTable } from "@/components/orders/orders-table"
import { ShippingPageLayout } from "@/components/orders/shipping/shipping-page-layout"
import {
  ConfirmOrderHeaderRow,
  ConfirmOrderRow,
} from "@/components/orders/shipping/shipping-order-row"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import { SHIPPING_WORK_META, orderConfirmRows } from "@/lib/shipping-worklist-utils"

/**
 * 送品の消し込みの② 出荷を確かめる（Issue #693、Epic #690）
 * URL: /orders/shipping/confirm
 *
 * 弥生ではまだ受注数量に届いていないが、最終工程完了・納期超過・納期間近のどれかに当てはまる注文。
 * このページからは送品済みにしない（弥生を正とする原則）。操作の列を置かないことで表す。
 * 弥生の取り込みより後が納期の未計上の注文は「取り込み待ち」として後ろへ回す（`orderConfirmRows()`。行数は変えない）
 */
export default function ShippingConfirmPage() {
  const shipping = useOrdersShipping()
  const { products, customers, isLoading, worklist, counts, latestSalesDate } = shipping
  const rows = useMemo(
    () => orderConfirmRows(worklist.confirm, latestSalesDate),
    [worklist.confirm, latestSalesDate],
  )
  const meta = SHIPPING_WORK_META.confirm

  return (
    <ShippingPageLayout
      {...shipping}
      title={`② ${meta.label}`}
      count={counts.confirm}
      unit={meta.unit}
    >
      {shipping.isShipmentError ? (
        <div className="rounded-lg border bg-card p-8 text-center text-red-600">
          弥生の送品を取得できませんでした
        </div>
      ) : (
        <OrdersTable
          fill
          isLoading={isLoading}
          header={<ConfirmOrderHeaderRow />}
          rowCount={rows.length}
          emptyState={<p>出荷を確かめる注文はありません</p>}
        >
          {rows.map((row) => (
            <ConfirmOrderRow
              key={row.order.id}
              row={row}
              products={products}
              customers={customers}
              latestSalesDate={latestSalesDate}
            />
          ))}
        </OrdersTable>
      )}
    </ShippingPageLayout>
  )
}
