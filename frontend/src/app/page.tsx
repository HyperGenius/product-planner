"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  Plus,
  ClipboardList,
  Clock,
  FileText,
  CheckCircle2,
  TrendingUp,
  ArrowRight,
  CalendarDays,
  PackageSearch,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { format, startOfDay, addDays, startOfWeek } from "date-fns"
import { ja } from "date-fns/locale"
import { getProductName, getStatusLabel } from "@/lib/order-utils"

const statusBadgeClass: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  confirmed: "bg-green-100 text-green-800 border border-green-200",
  in_progress: "bg-blue-100 text-blue-800 border border-blue-200",
  completed: "bg-gray-100 text-gray-600 border border-gray-200",
}

export default function Home() {
  const router = useRouter()
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const today = useMemo(() => startOfDay(new Date()), [])
  const tomorrow = useMemo(() => addDays(today, 1), [today])
  const weekStart = useMemo(() => startOfWeek(today, { locale: ja }), [today])

  const todayDueCount = useMemo(() => {
    return orders?.filter((order) => {
      if (!order.confirmed_deadline) return false
      const deadline = new Date(order.confirmed_deadline)
      return deadline >= today && deadline < tomorrow
    }).length ?? 0
  }, [orders, today, tomorrow])

  const draftOrdersCount = useMemo(() => {
    return orders?.filter((order) => order.status === "draft").length ?? 0
  }, [orders])

  const confirmedOrdersCount = useMemo(() => {
    return orders?.filter((order) => order.status === "confirmed").length ?? 0
  }, [orders])

  const weeklyOrdersCount = useMemo(() => {
    return orders?.filter((order) => order.created_at && new Date(order.created_at) >= weekStart).length ?? 0
  }, [orders, weekStart])

  const recentOrders = useMemo(() => {
    if (!orders) return []
    return [...orders]
      .sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
      .slice(0, 5)
  }, [orders])

  const kpiCards = [
    {
      label: "今日の納期",
      value: ordersLoading ? "…" : todayDueCount,
      unit: "件",
      icon: Clock,
      accent: "border-t-blue-500",
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
      sub: null,
    },
    {
      label: "未確定注文",
      value: ordersLoading ? "…" : draftOrdersCount,
      unit: "件",
      icon: FileText,
      accent: "border-t-orange-400",
      iconBg: "bg-orange-50",
      iconColor: "text-orange-500",
      sub: null,
    },
    {
      label: "確定済み注文",
      value: ordersLoading ? "…" : confirmedOrdersCount,
      unit: "件",
      icon: CheckCircle2,
      accent: "border-t-green-500",
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
      sub: null,
    },
    {
      label: "今週の受注",
      value: ordersLoading ? "…" : weeklyOrdersCount,
      unit: "件",
      icon: TrendingUp,
      accent: "border-t-purple-500",
      iconBg: "bg-purple-50",
      iconColor: "text-purple-600",
      sub: null,
    },
  ]

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      {/* ページヘッダー */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">ダッシュボード</h1>
          <p className="text-muted-foreground mt-1">今日の生産状況をご確認ください</p>
        </div>
        <div className="text-right text-sm text-muted-foreground pt-1">
          <div className="flex items-center gap-1.5 justify-end">
            <CalendarDays className="h-4 w-4" />
            <span>{format(new Date(), "yyyy年M月d日（E）", { locale: ja })}</span>
          </div>
        </div>
      </div>

      {/* KPI カード */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-8">
        {kpiCards.map((card) => (
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

      {/* クイックアクション */}
      <div className="rounded-lg border bg-card p-6 shadow-sm mb-6">
        <h2 className="text-base font-semibold mb-4">クイックアクション</h2>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => router.push("/orders/new")} size="lg" className="gap-2">
            <Plus className="h-5 w-5" />
            新規注文を入力する
          </Button>
          <Button
            onClick={() => router.push("/schedule")}
            size="lg"
            variant="outline"
            className="gap-2"
          >
            <ClipboardList className="h-5 w-5" />
            生産スケジュールを確認する
          </Button>
        </div>
      </div>

      {/* 最新の注文 */}
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-base font-semibold">最新の注文</h2>
          <Button variant="ghost" size="sm" onClick={() => router.push("/orders")} className="gap-1 text-sm">
            すべて表示
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {ordersLoading || productsLoading ? (
          <div className="py-12 text-center text-muted-foreground">
            <div className="animate-pulse">読み込み中...</div>
          </div>
        ) : recentOrders.length > 0 ? (
          <div className="divide-y">
            {recentOrders.map((order) => (
              <div
                key={order.id}
                onClick={() => router.push(`/orders/${order.id}`)}
                className="flex items-center justify-between px-6 py-4 hover:bg-accent/40 transition-colors cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-sm">{order.order_no}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        statusBadgeClass[order.status] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {getStatusLabel(order.status)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {getProductName(order.product_id, products)} × {order.quantity}
                  </p>
                </div>
                <div className="text-right text-sm text-muted-foreground ml-4 shrink-0">
                  {order.confirmed_deadline
                    ? format(new Date(order.confirmed_deadline), "yyyy/MM/dd", { locale: ja })
                    : "納期未確定"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center">
            <PackageSearch className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">まだ注文がありません</p>
            <Button variant="outline" onClick={() => router.push("/orders/new")} className="gap-2">
              <Plus className="h-4 w-4" />
              最初の注文を作成する
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
