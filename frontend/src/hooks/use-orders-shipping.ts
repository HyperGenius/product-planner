"use client"

import { useMemo } from "react"
import { useOrders } from "@/hooks/use-orders"
import { useOrderProgressList } from "@/hooks/use-daily-report-progress"
import {
  useShipmentOrderMatches,
  useShipmentOrderReviews,
  useShipmentUnmatchedEntries,
} from "@/hooks/use-shipments"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import { isShippingTarget } from "@/lib/shipping-candidate-utils"
import { classifyShippingWorklist } from "@/lib/shipping-worklist-utils"
import type { Order } from "@/types/order"
import type { ShipmentOrderReviewList, ShipmentUnmatchedList } from "@/types/shipment"

/**
 * 送品の消し込みの振り分け（Issue #557 / #691）。対象（確定済・生産中）の注文の進捗と弥生の送品をまとめて引き、
 * `classifyShippingWorklist()` で①②・対象外に振り分ける。
 * 「送品の消し込み」画面とサイドバーの件数バッジで共有し、進捗・弥生の送品を同じクエリキーで取って二重に取得しない。
 * 送品で対象の ID が変わっても表が読み込み中に戻らないよう、直前の結果を残す（Issue #649）。
 *
 * 注文の振り分けは弥生の明細の一覧・日報の参考に依存しないので、それらを渡さないバッジと画面で①の件数は一致する
 *
 * @param orders 注文の一覧。undefined の間は進捗を取得しない
 * @param extra 画面だけが渡す、弥生の明細（③・前提）と日報の参考の一覧
 */
export function useShippingRows(
  orders: Order[] | undefined,
  extra?: { unmatchedEntries?: ShipmentUnmatchedList; orderReviews?: ShipmentOrderReviewList },
) {
  const targetOrderIds = useMemo(
    () => (orders ?? []).filter(isShippingTarget).map((o) => o.id),
    [orders]
  )
  const progress = useOrderProgressList(targetOrderIds, { keepPrevious: true })
  const shipments = useShipmentOrderMatches(targetOrderIds, { keepPrevious: true })
  const unmatchedEntries = extra?.unmatchedEntries
  const orderReviews = extra?.orderReviews

  const worklist = useMemo(
    () =>
      classifyShippingWorklist({
        orders: orders ?? [],
        progressItems: progress.data?.items,
        shipmentMatches: shipments.data?.items,
        unmatchedEntries,
        orderReviews,
      }),
    [orders, progress.data, shipments.data, unmatchedEntries, orderReviews]
  )

  return {
    worklist,
    computedAt: progress.data?.computed_at ?? null,
    // 弥生の送品が届く前に数えると、①の注文が②・対象外に見える
    isProgressLoading: progress.isLoading || shipments.isLoading,
    isProgressError: progress.isError,
    latestSalesDate: shipments.data?.latest_sales_date ?? null,
    isShipmentError: shipments.isError,
  }
}

/**
 * 「送品の消し込み」画面（Issue #557 / #692）のデータ。行操作（送品）は `useOrderActions()` を使う
 */
export function useOrdersShipping() {
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const { data: currentMember } = useCurrentMember()
  const currentUserRole = currentMember?.role ?? null
  const unmatched = useShipmentUnmatchedEntries()
  const orderReviews = useShipmentOrderReviews()
  const shipping = useShippingRows(orders, {
    unmatchedEntries: unmatched.data,
    orderReviews: orderReviews.data,
  })

  return {
    orders,
    products,
    customers,
    // 進捗が届く前に出すと、最終工程が完了した注文が②から漏れて見える
    isLoading: ordersLoading || productsLoading || customersLoading || shipping.isProgressLoading,
    currentUserRole,
    unmatched,
    orderReviews,
    ...shipping,
  }
}
