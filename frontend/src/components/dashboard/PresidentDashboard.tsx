"use client"

import type { DashboardMetrics } from "@/hooks/use-dashboard-metrics"
import type { Product } from "@/types/product"
import { DashboardHeader } from "./DashboardHeader"
import { KpiCards } from "./KpiCards"
import { PendingApprovalBanner } from "./PendingApprovalBanner"
import { QuickActions } from "./QuickActions"
import { RecentOrders } from "./RecentOrders"

interface PresidentDashboardProps {
  metrics: DashboardMetrics
  products: Product[] | undefined
  ordersLoading: boolean
  productsLoading: boolean
}

/**
 * president 向けダッシュボードの器（Issue #401）。
 *
 * 初期実装は DefaultDashboard と同じ要素（承認待ちバナー・KPI 4枚・クイックアクション・最新の注文）を
 * 移植しただけで挙動は変えない。KPI の差し替えは #ISSUE_D、承認待ちキュー化は #ISSUE_B、
 * リスクカードは #ISSUE_C で本コンポーネントに差し込む。
 * データ取得は `DashboardRouter` に集約し、本コンポーネントは表示専用。
 */
export function PresidentDashboard({
  metrics,
  products,
  ordersLoading,
  productsLoading,
}: PresidentDashboardProps) {
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
