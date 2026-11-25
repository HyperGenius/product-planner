"use client"

import { ShippingPageLayout } from "@/components/orders/shipping/shipping-page-layout"
import { UnmatchedShipmentEntries } from "@/components/orders/shipping/unmatched-shipment-entries"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import { SHIPPING_PREREQUISITE_META } from "@/lib/shipping-worklist-utils"

/**
 * 送品の消し込みの前提「送り先の受注を確かめる」（Issue #693、Epic #690）
 * URL: /orders/shipping/ambiguous
 *
 * 同じ顧客・製品の受注が複数あり、どの受注の送品か決まらない弥生の明細（`ambiguous`）。ハブの前提バナーの
 * 「受注を確かめる」から開く。①②の行の「送り先未定」の印からも開く。弥生の備考と、見比べる受注の希望納期・顧客注文番号を並べる。
 * 直す手段は受注の顧客注文番号・希望納期を直すことなので、受注へのリンクだけを置く（明細から受注を選ぶ操作は別 Issue）
 */
export default function ShippingAmbiguousPage() {
  const shipping = useOrdersShipping()
  const { orders, products, customers, worklist, counts, unmatched } = shipping
  const meta = SHIPPING_PREREQUISITE_META.ambiguous

  return (
    <ShippingPageLayout {...shipping} title={meta.label} count={counts.ambiguous} unit={meta.unit}>
      <UnmatchedShipmentEntries
        variant="ambiguous"
        items={worklist.prerequisite.ambiguous}
        emptyState="送り先の受注を決められない明細はありません"
        isLoading={unmatched.isLoading}
        isError={unmatched.isError}
        orders={orders}
        products={products}
        customers={customers}
      />
    </ShippingPageLayout>
  )
}
