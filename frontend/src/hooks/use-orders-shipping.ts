"use client"

import { useMemo } from "react"
import { useOrders } from "@/hooks/use-orders"
import { useOrderProgressList } from "@/hooks/use-daily-report-progress"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import {
  buildShippingRows,
  isShippingCandidate,
  isShippingTarget,
} from "@/lib/shipping-candidate-utils"
import type { Order } from "@/types/order"

/**
 * 送品の消し込みの行（Issue #557）。対象（確定済・生産中）の注文の進捗をまとめて引いて判定する。
 * 「送品の消し込み」画面とサイドバーの件数バッジで共有し、進捗を同じクエリキーで取って二重に取得しない
 *
 * @param orders 注文の一覧。undefined の間は進捗を取得しない
 */
export function useShippingRows(orders: Order[] | undefined) {
  const targetOrderIds = useMemo(
    () => (orders ?? []).filter(isShippingTarget).map((o) => o.id),
    [orders]
  )
  const progress = useOrderProgressList(targetOrderIds)

  const rows = useMemo(
    () => (orders ? buildShippingRows(orders, progress.data?.items) : []),
    [orders, progress.data]
  )
  const candidateRows = useMemo(() => rows.filter(isShippingCandidate), [rows])

  return {
    rows,
    candidateRows,
    computedAt: progress.data?.computed_at ?? null,
    isProgressLoading: progress.isLoading,
    isProgressError: progress.isError,
  }
}

/**
 * 「送品の消し込み」画面（Issue #557）のデータ。行操作（送品）は `useOrderActions()` を使う
 */
export function useOrdersShipping() {
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const { data: currentMember } = useCurrentMember()
  const currentUserRole = currentMember?.role ?? null
  const shipping = useShippingRows(orders)

  return {
    orders,
    products,
    customers,
    // 進捗が届く前に出すと、最終工程が完了した注文が候補から漏れて見える
    isLoading: ordersLoading || productsLoading || customersLoading || shipping.isProgressLoading,
    currentUserRole,
    ...shipping,
  }
}
