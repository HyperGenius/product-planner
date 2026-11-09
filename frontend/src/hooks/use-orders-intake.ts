"use client"

import { useMemo } from "react"
import { useLocationHash } from "@/hooks/use-location-hash"
import { useOrders } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import {
  compareOrders,
  getIntakeCategory,
  DEFAULT_SORT,
  INTAKE_CATEGORIES,
  toValidIntakeCategory,
  type IntakeCategory,
} from "@/lib/order-utils"
import type { Order } from "@/types/order"

/**
 * 「起票の確認」画面（Issue #555 / #654）のデータ。下書きを `getIntakeCategory()` の区分ごとに分け、
 * 区分内は希望納期の近い順に並べる。選択中の区分は URL のハッシュに持つ。
 * 行操作・一括操作は `useOrderActions()` / `useOrderBulkActions()` を使う
 */
export function useOrdersIntake() {
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const { data: currentMember } = useCurrentMember()
  const currentUserRole = currentMember?.role ?? null
  const canShipOverdueDrafts =
    currentUserRole === "president" || currentUserRole === "platform_admin"

  const ordersByCategory = useMemo(() => {
    const grouped = Object.fromEntries(
      INTAKE_CATEGORIES.map((category) => [category, [] as Order[]])
    ) as Record<IntakeCategory, Order[]>
    for (const order of orders ?? []) {
      const category = getIntakeCategory(order)
      if (category) grouped[category].push(order)
    }
    for (const category of INTAKE_CATEGORIES) {
      grouped[category].sort((a, b) => compareOrders(a, b, DEFAULT_SORT))
    }
    return grouped
  }, [orders])

  const counts = useMemo(
    () =>
      Object.fromEntries(
        INTAKE_CATEGORIES.map((category) => [category, ordersByCategory[category].length])
      ) as Record<IntakeCategory, number>,
    [ordersByCategory]
  )
  const draftCount = INTAKE_CATEGORIES.reduce((sum, category) => sum + counts[category], 0)

  const [hash, setHash] = useLocationHash()
  const selectedCategory = toValidIntakeCategory(hash, counts)

  // 一括操作（シミュ・承認依頼）の対象は「承認依頼を送る」の注文だけ
  const bulkTargetOrders = ordersByCategory.ready_to_request

  return {
    orders,
    products,
    customers,
    isLoading: ordersLoading || productsLoading || customersLoading,
    ordersByCategory,
    counts,
    draftCount,
    selectedCategory,
    selectCategory: setHash as (category: IntakeCategory) => void,
    bulkTargetOrders,
    currentUserRole,
    canShipOverdueDrafts,
  }
}
