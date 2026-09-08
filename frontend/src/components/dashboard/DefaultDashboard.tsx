"use client"

import { useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useDashboardMetrics } from "@/hooks/use-dashboard-metrics"
import { DashboardHeader } from "./DashboardHeader"
import { KpiCards } from "./KpiCards"
import { QuickActions } from "./QuickActions"
import { RecentOrders } from "./RecentOrders"

/**
 * 現行ダッシュボード（president 以外・ロールのローディング中のフォールバック）。
 *
 * Issue #401: `app/page.tsx` の中身をそのまま移植したもので、表示・挙動は変えていない。
 * 承認待ちバナーは現行どおり president 限定のため、ここでは描画しない（PresidentDashboard 側で表示）。
 */
export function DefaultDashboard() {
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const metrics = useDashboardMetrics(orders)

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <DashboardHeader />
      <KpiCards metrics={metrics} ordersLoading={ordersLoading} />
      <QuickActions />
      <RecentOrders
        recentOrders={metrics.recentOrders}
        products={products}
        ordersLoading={ordersLoading}
        productsLoading={productsLoading}
      />
    </div>
  )
}
