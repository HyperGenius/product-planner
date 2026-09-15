"use client"

import { useMemo } from "react"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"
import {
  getCustomerDisplayName,
  getProductDisplayParts,
  formatDeadlineDate,
  jstTodayIso,
} from "@/lib/order-utils"
import {
  IN_PRODUCTION_STATUSES,
  getEffectiveDeadline,
  getDeadlineStatus,
  getDaysRemaining,
} from "@/lib/floor-dashboard-utils"
import { DeadlineBadge } from "@/components/floor-dashboard/DeadlineBadge"

export interface CustomerOrderGroup {
  customerId: number | null
  customerName: string
  orders: Order[]
}

/**
 * 受注中（confirmed / in_progress）の注文を検索語で絞り込んだ上で顧客ごとにグループ化する（Issue #442）。
 * `filterText` は顧客名・製品名・注文番号のいずれかへの部分一致（検索・フィルタ #444 が渡す想定。
 * 本Issue単体では未使用＝空文字）。
 * グループは顧客名（50音）順、各グループ内の注文は納期の早い順（納期未設定は末尾）で並べる。
 */
export function groupOrdersByCustomer(
  orders: Order[] | undefined,
  customers: Customer[] | undefined,
): CustomerOrderGroup[] {
  const targetOrders = orders?.filter((o) => IN_PRODUCTION_STATUSES.includes(o.status)) ?? []

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
}

/**
 * 現場ダッシュボードの顧客別受注情報エリア（Issue #442）。
 * ホワイトボードの「顧客別受注情報」欄の置き換え。受注中（confirmed / in_progress）の注文を
 * 顧客ごとにグループ化し、各行に製品名（extracted_product_name フォールバック含む）・
 * 計画数量・納期・納期状態バッジを表示する。
 */
export function CustomerOrderList({
  orders,
  products,
  customers,
  isLoading,
}: CustomerOrderListProps) {
  const todayIso = jstTodayIso()
  const groups = useMemo(
    () => groupOrdersByCustomer(orders, customers),
    [orders, customers],
  )

  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="text-2xl font-bold mb-4">顧客別受注情報</h2>
      {isLoading ? (
        <p className="text-muted-foreground">読み込み中…</p>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground">受注中の注文はありません</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
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
                        <p className="text-sm text-muted-foreground">
                          {order.quantity ?? "-"} 個 ／ 納期 {formatDeadlineDate(deadline) ?? "未設定"}
                        </p>
                      </div>
                      <DeadlineBadge status={status} daysRemaining={daysRemaining} />
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
