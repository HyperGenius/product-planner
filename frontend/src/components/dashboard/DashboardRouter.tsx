"use client"

import { useCustomers } from "@/hooks/use-customers"
import { useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useDashboardMetrics } from "@/hooks/use-dashboard-metrics"
import { DefaultDashboard } from "./DefaultDashboard"
import { PresidentDashboard } from "./PresidentDashboard"

/**
 * ロール別にダッシュボードを出し分ける（Issue #401）。
 *
 * - `role === "president"` のとき PresidentDashboard
 * - それ以外・`currentMember` 未取得（ローディング）中は DefaultDashboard をフォールバック表示
 *
 * 初回描画で president → PresidentDashboard へ切り替わる際のちらつきはスケルトンなしで許容する。
 *
 * `useOrders()` / `useProducts()` はここで1回だけ呼び、両ダッシュボードには props で渡す。
 * 各ダッシュボード内で個別に呼ぶと、ロール判明時のコンポーネント切り替えで
 * 再マウント → 再フェッチ（TanStack Query は既定で staleTime=0）が走りうるため。
 *
 * `useCustomers()` は納期リスク注文カード（president 限定）の顧客名表示にのみ使うため、
 * `currentMember.role === "president"` が確定するまで `enabled: false` で fetch を止め、
 * それ以外のロールで不要な `/customers` 取得が走らないようにする（Issue #454 Copilotレビュー対応）。
 * `PresidentDashboard` にだけ渡す。
 */
export function DashboardRouter() {
  const { data: currentMember } = useCurrentMember()
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers } = useCustomers({
    enabled: currentMember?.role === "president",
  })
  const metrics = useDashboardMetrics(orders)

  const dashboardProps = {
    metrics,
    products,
    ordersLoading,
    productsLoading,
  }

  if (currentMember?.role === "president") {
    return (
      <PresidentDashboard
        {...dashboardProps}
        orders={orders}
        customers={customers}
      />
    )
  }

  return <DefaultDashboard {...dashboardProps} />
}
