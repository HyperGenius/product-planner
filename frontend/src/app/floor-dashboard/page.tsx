"use client"

import { useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import { useFloorDashboardMetrics } from "@/hooks/use-floor-dashboard-metrics"
import { FloorDashboardLayout } from "@/components/floor-dashboard/FloorDashboardLayout"
import { FloorDashboardHeader } from "@/components/floor-dashboard/FloorDashboardHeader"
import { FloorDashboardPhaseBanner } from "@/components/floor-dashboard/FloorDashboardPhaseBanner"
import { KpiSummaryCards } from "@/components/floor-dashboard/KpiSummaryCards"
import { CustomerOrderList } from "@/components/floor-dashboard/CustomerOrderList"

// 自動更新間隔（5分）
const REFETCH_INTERVAL_MS = 5 * 60 * 1000

export default function FloorDashboardPage() {
  const {
    data: orders,
    dataUpdatedAt,
    isError,
    isLoading,
  } = useOrders({ refetchInterval: REFETCH_INTERVAL_MS })
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const metrics = useFloorDashboardMetrics(orders)

  return (
    <FloorDashboardLayout>
      <FloorDashboardHeader
        lastUpdatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
        isError={isError}
      />
      <FloorDashboardPhaseBanner />
      <KpiSummaryCards metrics={metrics} isLoading={isLoading} />
      <CustomerOrderList
        orders={orders}
        products={products}
        customers={customers}
        isLoading={isLoading || productsLoading || customersLoading}
      />
      {/* 後続Issue（検索/フィルタ・出荷予定表）はここに差し込む */}
    </FloorDashboardLayout>
  )
}
