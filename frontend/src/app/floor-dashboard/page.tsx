"use client"

import { useState } from "react"
import { useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import { useSchedules } from "@/hooks/use-schedules"
import { useFloorDashboardMetrics } from "@/hooks/use-floor-dashboard-metrics"
import { jstTodayIso } from "@/lib/order-utils"
import {
  addDaysToIsoDate,
  SHIPMENT_SCHEDULE_WINDOW_DAYS,
  type OrderSearchFilters,
} from "@/lib/floor-dashboard-utils"
import { FloorDashboardLayout } from "@/components/floor-dashboard/FloorDashboardLayout"
import { FloorDashboardHeader } from "@/components/floor-dashboard/FloorDashboardHeader"
import { FloorDashboardPhaseBanner } from "@/components/floor-dashboard/FloorDashboardPhaseBanner"
import { KpiSummaryCards } from "@/components/floor-dashboard/KpiSummaryCards"
import { SearchAndFilterBar } from "@/components/floor-dashboard/SearchAndFilterBar"
import { CustomerOrderList } from "@/components/floor-dashboard/CustomerOrderList"
import { ShipmentScheduleList } from "@/components/floor-dashboard/ShipmentScheduleList"

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
  const [filters, setFilters] = useState<OrderSearchFilters>({
    searchText: "",
    overdueOnly: false,
  })

  const todayIso = jstTodayIso()
  const { data: schedules, isLoading: schedulesLoading } = useSchedules(
    {
      start_date: todayIso,
      end_date: addDaysToIsoDate(todayIso, SHIPMENT_SCHEDULE_WINDOW_DAYS),
    },
    { refetchInterval: REFETCH_INTERVAL_MS },
  )

  return (
    <FloorDashboardLayout>
      <FloorDashboardHeader
        lastUpdatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
        isError={isError}
      />
      <FloorDashboardPhaseBanner />
      <KpiSummaryCards metrics={metrics} isLoading={isLoading} />
      <SearchAndFilterBar filters={filters} onFiltersChange={setFilters} />
      <div className="grid grid-cols-2 gap-6 flex-1 min-h-0 overflow-hidden">
        <CustomerOrderList
          orders={orders}
          products={products}
          customers={customers}
          isLoading={isLoading || productsLoading || customersLoading}
          filters={filters}
        />
        <ShipmentScheduleList
          schedules={schedules}
          orders={orders}
          products={products}
          customers={customers}
          isLoading={isLoading || productsLoading || schedulesLoading}
          filters={filters}
        />
      </div>
    </FloorDashboardLayout>
  )
}
