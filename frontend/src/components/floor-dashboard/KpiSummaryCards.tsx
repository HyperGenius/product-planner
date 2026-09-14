"use client"

import { AlertTriangle, PackageCheck, Truck, type LucideIcon } from "lucide-react"
import type { FloorDashboardMetrics } from "@/hooks/use-floor-dashboard-metrics"

interface KpiCardDef {
  label: string
  value: number | string
  unit: string
  icon: LucideIcon
  accent: string
  iconBg: string
  iconColor: string
}

function buildCards(metrics: FloorDashboardMetrics, isLoading: boolean): KpiCardDef[] {
  return [
    {
      label: "受注中",
      value: isLoading ? "…" : metrics.inProductionCount,
      unit: "件",
      icon: PackageCheck,
      accent: "border-t-blue-500",
      iconBg: "bg-blue-50 dark:bg-blue-950",
      iconColor: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "納期超過",
      value: isLoading ? "…" : metrics.overdueCount,
      unit: "件",
      icon: AlertTriangle,
      accent: "border-t-red-500",
      iconBg: "bg-red-50 dark:bg-red-950",
      iconColor: "text-red-600 dark:text-red-400",
    },
    {
      label: "本日出荷予定",
      value: isLoading ? "…" : metrics.todayShippingCount,
      unit: "件",
      icon: Truck,
      accent: "border-t-green-500",
      iconBg: "bg-green-50 dark:bg-green-950",
      iconColor: "text-green-600 dark:text-green-400",
    },
  ]
}

interface KpiSummaryCardsProps {
  metrics: FloorDashboardMetrics
  isLoading: boolean
}

/**
 * 現場ダッシュボードの KPI サマリーカード（受注中件数・納期超過件数・本日出荷予定件数。Issue #441）。
 * 大型ディスプレイでの常時表示を想定し、`components/dashboard/KpiCards.tsx` より
 * 大きめの文字サイズで表示する。「納期超過」は0件超で強調表示する。
 */
export function KpiSummaryCards({ metrics, isLoading }: KpiSummaryCardsProps) {
  const cards = buildCards(metrics, isLoading)

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((card) => {
        const isOverdueWithCount = card.label === "納期超過" && !isLoading && metrics.overdueCount > 0
        return (
          <div
            key={card.label}
            className={`rounded-lg border-t-4 ${card.accent} border border-border bg-card p-6 shadow-sm ${
              isOverdueWithCount ? "ring-2 ring-red-400 dark:ring-red-700" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-medium text-muted-foreground mb-2">{card.label}</p>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-6xl font-bold ${isOverdueWithCount ? "text-red-600 dark:text-red-400" : ""}`}
                  >
                    {card.value}
                  </span>
                  <span className="text-xl text-muted-foreground">{card.unit}</span>
                </div>
              </div>
              <div className={`rounded-lg ${card.iconBg} p-4`}>
                <card.icon className={`h-8 w-8 ${card.iconColor}`} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
