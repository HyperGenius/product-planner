"use client"

import { useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useDashboardMetrics } from "@/hooks/use-dashboard-metrics"
import { DashboardHeader } from "./DashboardHeader"
import { KpiCards } from "./KpiCards"
import { PendingApprovalBanner } from "./PendingApprovalBanner"
import { QuickActions } from "./QuickActions"
import { RecentOrders } from "./RecentOrders"

/**
 * president 向けダッシュボードの器（Issue #401）。
 *
 * 初期実装は DefaultDashboard と同じ要素（承認待ちバナー・KPI 4枚・クイックアクション・最新の注文）を
 * 移植しただけで挙動は変えない。KPI の差し替えは #ISSUE_D、承認待ちキュー化は #ISSUE_B、
 * リスクカードは #ISSUE_C で本コンポーネントに差し込む。
 */
export function PresidentDashboard() {
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const metrics = useDashboardMetrics(orders)

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <DashboardHeader />
      <PendingApprovalBanner
        pendingApprovalCount={metrics.pendingApprovalCount}
        ordersLoading={ordersLoading}
      />
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
