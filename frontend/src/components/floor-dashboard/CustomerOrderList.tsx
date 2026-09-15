"use client"

import { useMemo } from "react"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"
import { getCustomerDisplayName, getProductDisplayParts, jstTodayIso } from "@/lib/order-utils"
import {
  IN_PRODUCTION_STATUSES,
  getEffectiveDeadline,
  getDeadlineStatus,
  getDaysRemaining,
  matchesSearchText,
  type OrderSearchFilters,
} from "@/lib/floor-dashboard-utils"
import { RemainingDaysLabel } from "@/components/floor-dashboard/RemainingDaysLabel"
import { QuantityBadge, DeadlineValueBadge } from "@/components/floor-dashboard/PlanValueBadges"

export interface CustomerOrderGroup {
  customerId: number | null
  customerName: string
  orders: Order[]
}

/**
 * 受注中（confirmed / in_progress）の注文を検索語・「納期遅れのみ」フィルタで絞り込んだ上で
 * 顧客ごとにグループ化する（Issue #442, #444）。
 * グループは顧客名（50音）順、各グループ内の注文は納期の早い順（納期未設定は末尾）で並べる。
 */
export function groupOrdersByCustomer(
  orders: Order[] | undefined,
  products: Product[] | undefined,
  customers: Customer[] | undefined,
  filters: OrderSearchFilters,
  todayIso: string,
): CustomerOrderGroup[] {
  const targetOrders = (orders?.filter((o) => IN_PRODUCTION_STATUSES.includes(o.status)) ?? [])
    .filter((order) => {
      if (!filters.overdueOnly) return true
      const deadline = getEffectiveDeadline(order)
      return getDeadlineStatus(deadline, todayIso) === "overdue"
    })
    .filter((order) => {
      const customerName =
        order.customer_id != null ? getCustomerDisplayName(order.customer_id, customers) : null
      const product = getProductDisplayParts(order.product_id, products, order.extracted_product_name)
      return matchesSearchText(filters.searchText, {
        customerName,
        productPrimary: product.primary,
        productSecondary: product.secondary,
        orderNumber: order.order_no,
      })
    })

  const groupsByCustomerId = new Map<number | null, CustomerOrderGroup>()
  for (const order of targetOrders) {
    const customerId = order.customer_id ?? null
    const existing = groupsByCustomerId.get(customerId)
    if (existing) {
      existing.orders.push(order)
    } else {
      groupsByCustomerId.set(customerId, {
        customerId,
        customerName:
          customerId != null ? getCustomerDisplayName(customerId, customers) : "顧客未設定",
        orders: [order],
      })
    }
  }

  const groups = Array.from(groupsByCustomerId.values())
  for (const group of groups) {
    group.orders.sort((a, b) => {
      const deadlineA = getEffectiveDeadline(a) ?? ""
      const deadlineB = getEffectiveDeadline(b) ?? ""
      if (!deadlineA && !deadlineB) return 0
      if (!deadlineA) return 1
      if (!deadlineB) return -1
      return deadlineA.localeCompare(deadlineB)
    })
  }

  groups.sort((a, b) => a.customerName.localeCompare(b.customerName, "ja"))
  return groups
}

interface CustomerOrderListProps {
  orders: Order[] | undefined
  products: Product[] | undefined
  customers: Customer[] | undefined
  isLoading: boolean
  filters: OrderSearchFilters
}

/**
 * 現場ダッシュボードの顧客別受注情報エリア（Issue #442）。
 * ホワイトボードの「顧客別受注情報」欄の置き換え。受注中（confirmed / in_progress）の注文を
 * 検索語・「納期遅れのみ」フィルタ（Issue #444）で絞り込んだ上で顧客ごとにグループ化し、
 * 各行に製品名（extracted_product_name フォールバック含む）・計画数量・納期・納期状態バッジを表示する。
 */
export function CustomerOrderList({
  orders,
  products,
  customers,
  isLoading,
  filters,
}: CustomerOrderListProps) {
  const todayIso = jstTodayIso()
  const groups = useMemo(
    () => groupOrdersByCustomer(orders, products, customers, filters, todayIso),
    [orders, products, customers, filters, todayIso],
  )

  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm h-full flex flex-col overflow-hidden">
      <h2 className="text-2xl font-bold mb-4 shrink-0">顧客別受注情報</h2>
      {isLoading ? (
        <p className="text-muted-foreground">読み込み中…</p>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground">
          {filters.searchText || filters.overdueOnly
            ? "条件に一致する受注はありません"
            : "受注中の注文はありません"}
        </p>
      ) : (
        <div className="grid gap-6 grid-cols-1 overflow-y-auto flex-1 min-h-0">
          {groups.map((group) => (
            <div key={group.customerId ?? "unassigned"} className="rounded-md border border-border">
              <h3 className="text-lg font-semibold px-4 py-2 border-b border-border bg-muted/50">
                {group.customerName}
              </h3>
              <ul className="divide-y divide-border">
                {group.orders.map((order) => {
                  const product = getProductDisplayParts(
                    order.product_id,
                    products,
                    order.extracted_product_name,
                  )
                  const deadline = getEffectiveDeadline(order)
                  const status = getDeadlineStatus(deadline, todayIso)
                  const daysRemaining = deadline ? getDaysRemaining(deadline, todayIso) : undefined
                  return (
                    <li key={order.id} className="px-4 py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {product.primary}
                          {product.secondary && (
                            <span className="ml-2 text-sm text-muted-foreground">
                              {product.secondary}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <QuantityBadge quantity={order.quantity} />
                        <DeadlineValueBadge deadline={deadline} todayIso={todayIso} status={status} />
                        <RemainingDaysLabel status={status} daysRemaining={daysRemaining} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
