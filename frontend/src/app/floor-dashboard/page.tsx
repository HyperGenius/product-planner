"use client"

import { useOrders } from "@/hooks/use-orders"
import { FloorDashboardLayout } from "@/components/floor-dashboard/FloorDashboardLayout"
import { FloorDashboardHeader } from "@/components/floor-dashboard/FloorDashboardHeader"
import { FloorDashboardPhaseBanner } from "@/components/floor-dashboard/FloorDashboardPhaseBanner"

// 自動更新間隔（5分）
const REFETCH_INTERVAL_MS = 5 * 60 * 1000

export default function FloorDashboardPage() {
  const { dataUpdatedAt, isError } = useOrders({ refetchInterval: REFETCH_INTERVAL_MS })

  return (
    <FloorDashboardLayout>
      <FloorDashboardHeader
        lastUpdatedAt={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
        isError={isError}
      />
      <FloorDashboardPhaseBanner />
      {/* 後続Issue（KPI・検索/フィルタ・顧客別受注情報・出荷予定表）はここに差し込む */}
    </FloorDashboardLayout>
  )
}
