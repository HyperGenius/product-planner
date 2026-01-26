"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { getProductName, getStatusLabel } from "@/lib/order-utils"

/**
 * 注文一覧画面
 * URL: /orders
 */
export default function OrdersPage() {
  const router = useRouter()
  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">注文一覧</h1>
          <p className="text-muted-foreground mt-2">
            登録された注文の一覧を表示します
          </p>
        </div>
        <Button onClick={() => router.push("/orders/new")}>
          <Plus className="mr-2 h-4 w-4" />
          新規注文
        </Button>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        {ordersLoading || productsLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            読み込み中...
          </div>
        ) : orders && orders.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>注文番号</TableHead>
                <TableHead>製品</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>希望納期</TableHead>
                <TableHead>確定納期</TableHead>
                <TableHead>ステータス</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.order_no}</TableCell>
                  <TableCell>{getProductName(order.product_id, products)}</TableCell>
                  <TableCell className="text-right">{order.quantity}</TableCell>
                  <TableCell>
                    {order.desired_deadline
                      ? format(new Date(order.desired_deadline), "yyyy/MM/dd HH:mm", {
                          locale: ja,
                        })
                      : "-"}
                  </TableCell>
                  <TableCell>
                    {order.confirmed_deadline
                      ? format(new Date(order.confirmed_deadline), "yyyy/MM/dd HH:mm", {
                          locale: ja,
                        })
                      : "-"}
                  </TableCell>
                  <TableCell>{getStatusLabel(order.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            <p>まだ注文がありません</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => router.push("/orders/new")}
            >
              <Plus className="mr-2 h-4 w-4" />
              新規注文を作成
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
