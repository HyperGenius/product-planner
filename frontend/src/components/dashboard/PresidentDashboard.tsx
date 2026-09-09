"use client"

import type { DashboardMetrics } from "@/hooks/use-dashboard-metrics"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import { ApprovalQueueCard } from "./ApprovalQueueCard"
import { DashboardHeader } from "./DashboardHeader"
import { DeadlineRiskCard } from "./DeadlineRiskCard"
import { KpiCards } from "./KpiCards"
import { QuickActions } from "./QuickActions"
import { RecentOrders } from "./RecentOrders"

interface PresidentDashboardProps {
  metrics: DashboardMetrics
  /** DashboardRouter が1回だけ取得した注文一覧（承認待ちキュー表示に使う。Issue #402） */
  orders: Order[] | undefined
  products: Product[] | undefined
  ordersLoading: boolean
  productsLoading: boolean
}

/**
 * president 向けダッシュボードの器（Issue #401）。
 *
 * 承認待ちバナー（件数のみ）は承認待ちキューカード（実リスト表示・Issue #402）へ置換済み。
 * 納期リスク注文カード（Issue #403）を承認待ちキューの直下に配置。
 * KPI 4枚は president 向けの指標に差し替え済み（`KpiCards` の `variant="president"`・Issue #404）。
 * データ取得は `DashboardRouter` に集約し、本コンポーネントは表示専用。
 */
export function PresidentDashboard({
  metrics,
  orders,
  products,
  ordersLoading,
  productsLoading,
}: PresidentDashboardProps) {
  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <DashboardHeader />
      <ApprovalQueueCard
        orders={orders}
        products={products}
        ordersLoading={ordersLoading}
      />
      <DeadlineRiskCard
        orders={orders}
        products={products}
        ordersLoading={ordersLoading}
      />
      <KpiCards metrics={metrics} ordersLoading={ordersLoading} variant="president" />
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
