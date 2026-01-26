"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { Plus, ClipboardList, Clock, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { format, startOfDay, addDays } from "date-fns"
import { ja } from "date-fns/locale"
import { getProductName, getStatusLabel } from "@/lib/order-utils"

export default function Home() {
  const router = useRouter()
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()

  // 今日の日付範囲
  const today = useMemo(() => startOfDay(new Date()), [])
  const tomorrow = useMemo(() => addDays(today, 1), [today])

  // KPI集計: 今日が納期の注文数
  const todayDueCount = useMemo(() => {
    return orders?.filter((order) => {
      if (!order.confirmed_deadline) return false
      const deadline = new Date(order.confirmed_deadline)
      return deadline >= today && deadline < tomorrow
    }).length || 0
  }, [orders, today, tomorrow])

  const draftOrdersCount = useMemo(() => {
    return orders?.filter((order) => order.status === "pending").length || 0
  }, [orders])

  // 最新5件の注文
  const recentOrders = useMemo(() => {
    if (!orders) return []
    return [...orders]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
  }, [orders])

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">ダッシュボード</h1>
        <p className="text-muted-foreground mt-2">
          Product Planner へようこそ
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 mb-6">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                今日の納期
              </p>
              <p className="text-3xl font-bold">
                {ordersLoading ? "..." : todayDueCount}
              </p>
              <p className="text-sm text-muted-foreground mt-1">件</p>
            </div>
            <div className="rounded-full bg-primary/10 p-3">
              <Clock className="h-6 w-6 text-primary" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Draft（未確定）
              </p>
              <p className="text-3xl font-bold">
                {ordersLoading ? "..." : draftOrdersCount}
              </p>
              <p className="text-sm text-muted-foreground mt-1">件</p>
            </div>
            <div className="rounded-full bg-orange-500/10 p-3">
              <FileText className="h-6 w-6 text-orange-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-lg border bg-card p-6 shadow-sm mb-6">
        <h2 className="text-lg font-semibold mb-4">クイックアクション</h2>
        <Button onClick={() => router.push("/orders/new")} size="lg">
          <Plus className="mr-2 h-5 w-5" />
          新規注文を入力する
        </Button>
      </div>

      {/* Recent Orders */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">最新の注文</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/orders")}
          >
            <ClipboardList className="mr-2 h-4 w-4" />
            すべて表示
          </Button>
        </div>

        {ordersLoading || productsLoading ? (
          <div className="py-8 text-center text-muted-foreground">
            読み込み中...
          </div>
        ) : recentOrders.length > 0 ? (
          <div className="space-y-3">
            {recentOrders.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-4 rounded-lg border bg-background hover:bg-accent/50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{order.order_no}</span>
                    <span className="text-sm px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                      {getStatusLabel(order.status)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {getProductName(order.product_id, products)} × {order.quantity}
                  </p>
                </div>
                <div className="text-right text-sm text-muted-foreground">
                  {order.confirmed_deadline
                    ? format(new Date(order.confirmed_deadline), "yyyy/MM/dd HH:mm", {
                        locale: ja,
                      })
                    : "納期未確定"}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            <p className="mb-4">まだ注文がありません</p>
            <Button
              variant="outline"
              onClick={() => router.push("/orders/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              新規注文を作成
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
