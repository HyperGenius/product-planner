"use client"

import { ShippingPageLayout } from "@/components/orders/shipping/shipping-page-layout"
import { UnmatchedShipmentEntries } from "@/components/orders/shipping/unmatched-shipment-entries"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import { SHIPPING_WORK_META } from "@/lib/shipping-worklist-utils"

/**
 * 送品の消し込みの③ 受注を起票する（Issue #693、Epic #690）
 * URL: /orders/shipping/register
 *
 * 名寄せは済んでいるのに、対応する受注が無い弥生の明細（`no_order`）。行は (得意先, 商品コード) のまとまり。
 * 行の「受注を起票する」は、行の顧客・製品・数量・納期分を初期値にして受注作成を開き、作成したらこのページへ戻る（#694）
 */
export default function ShippingRegisterPage() {
  const shipping = useOrdersShipping()
  const { orders, products, customers, worklist, counts, unmatched } = shipping
  const meta = SHIPPING_WORK_META.register

  return (
    <ShippingPageLayout
      {...shipping}
      title={`③ ${meta.label}`}
      count={counts.register}
      unit={meta.unit}
    >
      <UnmatchedShipmentEntries
        variant="register"
        items={worklist.register}
        emptyState="起票する受注はありません"
        isLoading={unmatched.isLoading}
        isError={unmatched.isError}
        orders={orders}
        products={products}
        customers={customers}
      />
    </ShippingPageLayout>
  )
}
