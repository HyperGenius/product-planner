"use client"

import { useMemo } from "react"
import { useOrders } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import { compareApprovalRequests } from "@/lib/order-utils"

/**
 * 「承認」画面（Issue #556）のデータ。承認待ちの注文を承認依頼の古い順に並べる。
 * 行操作・一括操作は `useOrderActions()` / `useOrderBulkActions()` を使う
 */
export function useOrdersApproval() {
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const { data: currentMember } = useCurrentMember()
  const currentUserRole = currentMember?.role ?? null

  const pendingOrders = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => o.status === "pending_approval")
        .sort(compareApprovalRequests),
    [orders]
  )

  return {
    orders,
    products,
    customers,
    isLoading: ordersLoading || productsLoading || customersLoading,
    pendingOrders,
    currentUserRole,
  }
}
