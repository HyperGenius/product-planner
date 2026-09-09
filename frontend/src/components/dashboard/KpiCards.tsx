"use client"

import {
  Clock,
  FileText,
  CheckCircle2,
  TrendingUp,
  CalendarRange,
  Factory,
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

/**
 * president 向け KPI 定義（Issue #404）。
 *
 * テナント全体の汎用集計ではなく、社長が気にする粒度（納期の逼迫度・生産中の規模・
 * 今週の確定ペース）に寄せた仮の4指標。承認待ち・納期リスクは専用のキューカード
 * （ApprovalQueueCard / DeadlineRiskCard）で表示するため、ここでは扱わない。
 * この4指標は暫定で、現場フィードバック後に別Issueで見直す想定。
 */
export function buildPresidentKpiCards(
  metrics: DashboardMetrics,
  ordersLoading: boolean,
): KpiCard[] {
  return [
    {
      label: "今日納期の注文",
      value: ordersLoading ? "…" : metrics.todayDueCount,
      unit: "件",
      icon: Clock,
      accent: "border-t-blue-500",
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
      sub: null,
    },
    {
      label: "今週納期の注文",
      value: ordersLoading ? "…" : metrics.thisWeekDueCount,
      unit: "件",
      icon: CalendarRange,
      accent: "border-t-orange-400",
      iconBg: "bg-orange-50",
      iconColor: "text-orange-500",
      sub: null,
    },
    {
      label: "生産中の注文",
      value: ordersLoading ? "…" : metrics.inProductionCount,
      unit: "件",
      icon: Factory,
      accent: "border-t-sky-500",
      iconBg: "bg-sky-50",
      iconColor: "text-sky-600",
      sub: null,
    },
    {
      label: "今週確定した注文",
      value: ordersLoading ? "…" : metrics.weeklyConfirmedCount,
      unit: "件",
      icon: CheckCircle2,
      accent: "border-t-green-500",
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
      sub: null,
    },
  ]
}

interface KpiCardsProps {
  metrics: DashboardMetrics
  ordersLoading: boolean
  /**
   * 表示する KPI セット。`"default"`（既定）は現行の汎用4指標、
   * `"president"` は社長向けに差し替えた4指標（Issue #404）。
   */
  variant?: "default" | "president"
}

/**
 * KPI カード 4 枚のグリッド。現行 `app/page.tsx` のマークアップをそのまま移植。
 * `variant` で default（現行）／president 向けの指標セットを出し分ける（Issue #404）。
 */
export function KpiCards({ metrics, ordersLoading, variant = "default" }: KpiCardsProps) {
  const cards =
    variant === "president"
      ? buildPresidentKpiCards(metrics, ordersLoading)
      : buildKpiCards(metrics, ordersLoading)

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
