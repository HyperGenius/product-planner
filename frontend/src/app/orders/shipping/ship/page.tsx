"use client"

import { OrdersTable } from "@/components/orders/orders-table"
import { ShippingPageLayout } from "@/components/orders/shipping/shipping-page-layout"
import { ShipOrderHeaderRow, ShipOrderRow } from "@/components/orders/shipping/shipping-order-row"
import { useOrderActions } from "@/hooks/use-order-actions"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import { SHIPPING_WORK_META } from "@/lib/shipping-worklist-utils"

/**
 * 送品の消し込みの① 送品済みにする（Issue #693、Epic #690）
 * URL: /orders/shipping/ship
 *
 * 弥生で受注数量の送品を確かめられた注文。送品の記録は弥生が正なので、担当者が内容を見て1件ずつ押す
 * （社長・受注担当。それ以外のロールは閲覧のみ）。行は `classifyShippingWorklist()` の①で、ハブの件数と一致する
 */
export default function ShippingShipPage() {
  const shipping = useOrdersShipping()
  const { orders, products, customers, isLoading, currentUserRole, worklist, counts } = shipping
  const actions = useOrderActions(orders)
  const meta = SHIPPING_WORK_META.ship

  return (
    <ShippingPageLayout {...shipping} title={`① ${meta.label}`} count={counts.ship} unit={meta.unit}>
      {shipping.isShipmentError ? (
        <ShipmentError />
      ) : (
        <OrdersTable
          fill
          isLoading={isLoading}
          header={<ShipOrderHeaderRow />}
          rowCount={worklist.ship.length}
          emptyState={<p>送品済みにする注文はありません</p>}
        >
          {worklist.ship.map((row) => (
            <ShipOrderRow
              key={row.order.id}
              row={row}
              products={products}
              customers={customers}
              currentUserRole={currentUserRole}
              {...actions.getRowProps(row.order)}
            />
          ))}
        </OrdersTable>
      )}
    </ShippingPageLayout>
  )
}

function ShipmentError() {
  return (
    <div className="rounded-lg border bg-card p-8 text-center text-red-600">
      弥生の送品を取得できませんでした
    </div>
  )
}
