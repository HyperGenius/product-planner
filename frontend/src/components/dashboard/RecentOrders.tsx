"use client"

import { useRouter } from "next/navigation"
import { ArrowRight, PackageSearch, Plus } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { getProductName, getStatusLabel } from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

const statusBadgeClass: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800 border border-yellow-200",
  confirmed: "bg-green-100 text-green-800 border border-green-200",
  in_progress: "bg-blue-100 text-blue-800 border border-blue-200",
  completed: "bg-gray-100 text-gray-600 border border-gray-200",
}

interface RecentOrdersProps {
  recentOrders: Order[]
  products: Product[] | undefined
  ordersLoading: boolean
  productsLoading: boolean
}

/**
 * 最新の注文リスト（最大5件）。現行 `app/page.tsx` から移植。
 */
export function RecentOrders({
  recentOrders,
  products,
  ordersLoading,
  productsLoading,
}: RecentOrdersProps) {
  const router = useRouter()

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <h2 className="text-base font-semibold">最新の注文</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/orders")}
          className="gap-1 text-sm"
        >
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
                  {getProductName(order.product_id, products, order.extracted_product_name)} ×{" "}
                  {order.quantity}
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
          <Button
            variant="outline"
            onClick={() => router.push("/orders/new")}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            最初の注文を作成する
          </Button>
        </div>
      )}
    </div>
  )
}
