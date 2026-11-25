"use client"

import { useMemo } from "react"
import { ShipmentOrderReviews } from "@/components/orders/shipping/shipment-order-reviews"
import { ShippingPageLayout } from "@/components/orders/shipping/shipping-page-layout"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import { SHIPPING_DAILY_REPORT_META } from "@/lib/shipping-worklist-utils"
import type { ShipmentOrderReview, ShipmentOrderReviewList } from "@/types/shipment"

/**
 * 送品の消し込みの参考「日報が未入力の出荷済み注文」（Issue #683 / #693、Epic #690）
 * URL: /orders/shipping/daily-reports
 *
 * 弥生の送品数量が、日報で追う最後の工程の良品数を超えている注文を、原因ごと・製品の単位で出す。
 * 件数と同じく、振り分けた注文（`worklist.dailyReportOrders`）の分だけを出す
 */
export default function ShippingDailyReportsPage() {
  const shipping = useOrdersShipping()
  const { orders, products, customers, isLoading, worklist, counts, orderReviews } = shipping

  const data = useMemo<ShipmentOrderReviewList | undefined>(
    () =>
      orderReviews.data && {
        ...orderReviews.data,
        items: worklist.dailyReportOrders
          .map((o) => o.marks.dailyReport)
          .filter((r): r is ShipmentOrderReview => r !== null),
      },
    [orderReviews.data, worklist.dailyReportOrders],
  )

  return (
    <ShippingPageLayout
      {...shipping}
      title={SHIPPING_DAILY_REPORT_META.label}
      count={counts.dailyReport}
      unit={SHIPPING_DAILY_REPORT_META.unit}
    >
      <ShipmentOrderReviews
        data={data}
        isLoading={orderReviews.isLoading || isLoading}
        isError={orderReviews.isError}
        orders={orders}
        products={products}
        customers={customers}
      />
    </ShippingPageLayout>
  )
}
