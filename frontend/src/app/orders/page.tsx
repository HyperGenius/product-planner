"use client"

import { useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { CheckCircle, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MasterPagination } from "@/components/master-pagination"
import { useConfirmOrder, useOrders } from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { getProductName, getCustomerName, getStatusLabel } from "@/lib/order-utils"
import type { Order } from "@/types/order"

const PAGE_SIZE = 20

type StatusFilter = "" | "draft" | "confirmed" | "incomplete" | "completed" | "canceled"
type SortKey = "created_at_desc" | "created_at_asc" | "desired_deadline_asc"

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "すべて", value: "" },
  { label: "下書き", value: "draft" },
  { label: "確定済", value: "confirmed" },
  { label: "情報不足", value: "incomplete" },
  { label: "完了", value: "completed" },
  { label: "キャンセル", value: "canceled" },
]

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "登録日（新しい順）", value: "created_at_desc" },
  { label: "登録日（古い順）", value: "created_at_asc" },
  { label: "希望納期（近い順）", value: "desired_deadline_asc" },
]

function filterOrder(order: Order, statusFilter: StatusFilter): boolean {
  if (statusFilter === "incomplete") return !order.customer_id || !order.desired_deadline
  if (statusFilter) return order.status === statusFilter
  return true
}

function compareOrders(a: Order, b: Order, sortKey: SortKey): number {
  if (sortKey === "created_at_desc") return b.created_at.localeCompare(a.created_at)
  if (sortKey === "created_at_asc") return a.created_at.localeCompare(b.created_at)
  // desired_deadline_asc: null を末尾に
  if (!a.desired_deadline && !b.desired_deadline) return 0
  if (!a.desired_deadline) return 1
  if (!b.desired_deadline) return -1
  return a.desired_deadline.localeCompare(b.desired_deadline)
}

/**
 * 注文一覧画面
 * URL: /orders
 */
export default function OrdersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const statusFilter = (searchParams.get("status") ?? "") as StatusFilter
  const sortKey = (searchParams.get("sort") ?? "created_at_desc") as SortKey
  const page = Number(searchParams.get("page") ?? "1")

  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const confirmOrder = useConfirmOrder()

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    // ステータスやソート変更時はページを1に戻す
    if (key !== "page") params.delete("page")
    router.push(`?${params.toString()}`)
  }

  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders
      .filter((order) => filterOrder(order, statusFilter))
      .sort((a, b) => compareOrders(a, b, sortKey))
  }, [orders, statusFilter, sortKey])

  const pagedOrders = useMemo(() => {
    const offset = (page - 1) * PAGE_SIZE
    return filteredOrders.slice(offset, offset + PAGE_SIZE)
  }, [filteredOrders, page])

  const handleConfirmOrder = (orderId: number, orderNo: string) => {
    if (!confirm(`注文「${orderNo}」を確定してスケジュールを作成しますか？`)) {
      return
    }

    confirmOrder.mutate(orderId, {
      onSuccess: () => {
        toast.success("注文を確定し、スケジュールを作成しました")
      },
      onError: (error: Error) => {
        toast.error(`確定に失敗しました: ${error.message}`)
      },
    })
  }

  const isLoading = ordersLoading || productsLoading || customersLoading

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

      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setParam("status", v)}
        >
          <TabsList>
            {STATUS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Select
          value={sortKey}
          onValueChange={(v) => setParam("sort", v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">
            読み込み中...
          </div>
        ) : pagedOrders.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>注文番号</TableHead>
                <TableHead>製品</TableHead>
                <TableHead>顧客</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead>希望納期</TableHead>
                <TableHead>確定納期</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedOrders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.order_no}</TableCell>
                  <TableCell>{getProductName(order.product_id, products)}</TableCell>
                  <TableCell>{getCustomerName(order.customer_id, customers)}</TableCell>
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
                      ? format(new Date(order.confirmed_deadline), "yyyy/MM/dd", {
                          locale: ja,
                        })
                      : "-"}
                  </TableCell>
                  <TableCell>{getStatusLabel(order.status)}</TableCell>
                  <TableCell className="text-right">
                    {order.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleConfirmOrder(order.id, order.order_no)}
                        disabled={confirmOrder.isPending}
                      >
                        <CheckCircle className="mr-1 h-3 w-3" />
                        確定
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="p-8 text-center text-muted-foreground">
            {statusFilter ? (
              <p>条件に一致する注文がありません</p>
            ) : (
              <>
                <p>まだ注文がありません</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => router.push("/orders/new")}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  新規注文を作成
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      <MasterPagination totalCount={filteredOrders.length} pageSize={PAGE_SIZE} />
    </div>
  )
}
