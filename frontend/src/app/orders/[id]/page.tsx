"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import {
  ArrowLeft,
  Calculator,
  Check,
  Pencil,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SimulationResult } from "@/components/simulation-result"
import { EditOrderDialog } from "@/components/orders/edit-order-dialog"
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog"
import {
  useOrder,
  useSimulateOrderById,
  useConfirmOrder,
  useDeleteOrder,
} from "@/hooks/use-orders"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import {
  getProductName,
  getCustomerName,
  getStatusLabel,
  getStatusBadgeClass,
} from "@/lib/order-utils"
import type { OrderSimulateResponse } from "@/types/order"

export default function OrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = Number(params.id)

  const { data: order, isLoading, isError } = useOrder(orderId)
  const { data: products } = useProducts()
  const { data: customers } = useCustomers()

  const simulateMutation = useSimulateOrderById()
  const confirmMutation = useConfirmOrder()
  const deleteMutation = useDeleteOrder()

  const [simulationResult, setSimulationResult] = useState<OrderSimulateResponse | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const handleSimulate = async () => {
    try {
      const result = await simulateMutation.mutateAsync(orderId)
      setSimulationResult(result)
      toast.success("シミュレーションが完了しました")
    } catch {
      toast.error("シミュレーションに失敗しました")
    }
  }

  const handleConfirm = async () => {
    try {
      await confirmMutation.mutateAsync(orderId)
      toast.success("注文を確定しました")
      router.push("/orders")
    } catch {
      toast.error("注文の確定に失敗しました")
    }
  }

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(orderId)
      toast.success("注文を削除しました")
      router.back()
    } catch {
      toast.error("注文の削除に失敗しました")
    }
  }

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return <span className="text-muted-foreground">未設定</span>
    return format(new Date(dateStr), "yyyy/MM/dd HH:mm", { locale: ja })
  }

  if (isLoading) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="p-8 text-center text-muted-foreground">読み込み中...</div>
      </div>
    )
  }

  if (isError || !order) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="p-8 text-center text-muted-foreground">
          注文が見つかりませんでした
        </div>
      </div>
    )
  }

  const isDraft = order.status === "draft"
  const canDelete = order.status === "draft" || order.status === "canceled"

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          戻る
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{order.order_no}</h1>
          <p className="text-muted-foreground mt-1">注文詳細</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左: 注文基本情報 */}
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h2 className="text-xl font-semibold mb-4">注文基本情報</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">注文番号</dt>
                <dd className="font-medium">{order.order_no}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">製品</dt>
                <dd>{getProductName(order.product_id, products)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">顧客</dt>
                <dd>{order.customer_id ? getCustomerName(order.customer_id, customers) : <span className="text-muted-foreground">未設定</span>}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">数量</dt>
                <dd>{order.quantity}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">希望納期</dt>
                <dd>{formatDate(order.desired_deadline)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">確定納期</dt>
                <dd>{formatDate(order.confirmed_deadline)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-muted-foreground">ステータス</dt>
                <dd>
                  <Badge className={getStatusBadgeClass(order.status)}>
                    {getStatusLabel(order.status)}
                  </Badge>
                </dd>
              </div>
            </dl>
          </div>

          {/* アクションボタン */}
          <div className="flex flex-wrap gap-3">
            {isDraft && (
              <Button
                onClick={handleSimulate}
                disabled={simulateMutation.isPending}
                className="flex-1"
              >
                <Calculator className="mr-2 h-4 w-4" />
                {simulateMutation.isPending ? "計算中..." : "シミュレーション実行"}
              </Button>
            )}
            {isDraft && order.is_scheduled && (
              <Button
                onClick={handleConfirm}
                disabled={confirmMutation.isPending}
                variant="default"
                className="flex-1"
              >
                <Check className="mr-2 h-4 w-4" />
                {confirmMutation.isPending ? "処理中..." : "注文確定"}
              </Button>
            )}
            {isDraft && (
              <Button
                variant="outline"
                onClick={() => setIsEditDialogOpen(true)}
              >
                <Pencil className="mr-2 h-4 w-4" />
                編集
              </Button>
            )}
            {canDelete && (
              <Button
                variant="destructive"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                削除
              </Button>
            )}
          </div>
        </div>

        {/* 右: シミュレーション結果 */}
        <div className="rounded-lg border bg-card p-6 shadow-sm min-h-[400px]">
          <h2 className="text-xl font-semibold mb-4">シミュレーション結果</h2>
          <SimulationResult
            result={simulationResult}
            desiredDeadline={order.desired_deadline}
          />
        </div>
      </div>

      <EditOrderDialog
        order={order}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
      />

      <DeleteOrderDialog
        order={isDeleteDialogOpen ? order : null}
        isPending={deleteMutation.isPending}
        onConfirm={handleDelete}
        onOpenChange={(open) => { if (!open) setIsDeleteDialogOpen(false) }}
      />
    </div>
  )
}
