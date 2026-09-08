"use client"

import {
  Clock,
  FileText,
  CheckCircle2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import type { DashboardMetrics } from "@/hooks/use-dashboard-metrics"

interface KpiCard {
  label: string
  value: number | string
  unit: string
  icon: LucideIcon
  accent: string
  iconBg: string
  iconColor: string
  sub: string | null
}

/**
 * 現行ダッシュボードの KPI 定義。ローディング中は値を "…" にする挙動も現行踏襲。
 */
export function buildKpiCards(metrics: DashboardMetrics, ordersLoading: boolean): KpiCard[] {
  return [
    {
      label: "今日の納期",
      value: ordersLoading ? "…" : metrics.todayDueCount,
      unit: "件",
      icon: Clock,
      accent: "border-t-blue-500",
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
      sub: null,
    },
    {
      label: "未確定注文",
      value: ordersLoading ? "…" : metrics.draftOrdersCount,
      unit: "件",
      icon: FileText,
      accent: "border-t-orange-400",
      iconBg: "bg-orange-50",
      iconColor: "text-orange-500",
      sub: null,
    },
    {
      label: "確定済み注文",
      value: ordersLoading ? "…" : metrics.confirmedOrdersCount,
      unit: "件",
      icon: CheckCircle2,
      accent: "border-t-green-500",
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
      sub: null,
    },
    {
      label: "今週の受注",
      value: ordersLoading ? "…" : metrics.weeklyOrdersCount,
      unit: "件",
      icon: TrendingUp,
      accent: "border-t-purple-500",
      iconBg: "bg-purple-50",
      iconColor: "text-purple-600",
      sub: null,
    },
  ]
}

interface KpiCardsProps {
  metrics: DashboardMetrics
  ordersLoading: boolean
}

/**
 * KPI カード 4 枚のグリッド。現行 `app/page.tsx` のマークアップをそのまま移植。
 */
export function KpiCards({ metrics, ordersLoading }: KpiCardsProps) {
  const cards = buildKpiCards(metrics, ordersLoading)

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-8">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`rounded-lg border-t-4 ${card.accent} border border-border bg-card p-5 shadow-sm`}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">{card.label}</p>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold">{card.value}</span>
                <span className="text-sm text-muted-foreground">{card.unit}</span>
              </div>
              {card.sub && (
                <p className="text-xs text-amber-700 mt-1 font-medium">{card.sub}</p>
              )}
            </div>
            <div className={`rounded-lg ${card.iconBg} p-2.5`}>
              <card.icon className={`h-5 w-5 ${card.iconColor}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
