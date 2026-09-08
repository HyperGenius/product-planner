"use client"

import type { DashboardMetrics } from "@/hooks/use-dashboard-metrics"
import type { Product } from "@/types/product"
import { DashboardHeader } from "./DashboardHeader"
import { KpiCards } from "./KpiCards"
import { QuickActions } from "./QuickActions"
import { RecentOrders } from "./RecentOrders"

interface DefaultDashboardProps {
  metrics: DashboardMetrics
  products: Product[] | undefined
  ordersLoading: boolean
  productsLoading: boolean
}

/**
 * 現行ダッシュボード（president 以外・ロールのローディング中のフォールバック）。
 *
 * Issue #401: `app/page.tsx` の中身をそのまま移植したもので、表示・挙動は変えていない。
 * 承認待ちバナーは現行どおり president 限定のため、ここでは描画しない（PresidentDashboard 側で表示）。
 * データ取得は `DashboardRouter` に集約し、本コンポーネントは表示専用。
 */
export function DefaultDashboard({
  metrics,
  products,
  ordersLoading,
  productsLoading,
}: DefaultDashboardProps) {
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
