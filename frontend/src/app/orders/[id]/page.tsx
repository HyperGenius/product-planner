"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Check,
  Download,
  Paperclip,
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
  useOrderAttachments,
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
  getCertaintyLabel,
  getCertaintyBadgeClass,
} from "@/lib/order-utils"
import type { OrderSimulateResponse } from "@/types/order"
import { ApiError } from "@/lib/api-client"

export default function OrderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orderId = Number(params.id)

  const { data: order, isLoading, isError } = useOrder(orderId)
  const { data: products } = useProducts()
  const { data: customers } = useCustomers()
  const { data: attachments } = useOrderAttachments(orderId)

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
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.errorCode === "no_routing") {
        toast.error("工程が設定されていないため、シミュレーションを実行できません。", {
          description: "製品マスタから工程を設定してください。",
          action: {
            label: "工程を設定する",
            onClick: () => router.push("/master/products"),
          },
        })
      } else {
        toast.error("シミュレーションに失敗しました")
      }
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
  const hasNoRouting = order.has_no_routings === true && !order.is_scheduled
  const hasUnconfirmedRouting =
    order.has_unconfirmed_routings === true && !hasNoRouting && !order.is_scheduled
  const blocksSimulation = hasNoRouting || hasUnconfirmedRouting

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          戻る
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{order.order_no ?? `注文 #${order.id}`}</h1>
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
                <dd className="font-medium">{order.order_no ?? <span className="text-muted-foreground">未設定</span>}</dd>
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
              {order.customer_certainty && (
                <div className="flex justify-between items-center">
                  <dt className="text-muted-foreground">顧客側の確度</dt>
                  <dd>
                    <Badge className={getCertaintyBadgeClass(order.customer_certainty)}>
                      {getCertaintyLabel(order.customer_certainty)}
                    </Badge>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* メール本文パネル (メール起票時のみ) */}
          {order.source_type === 'email' && order.source_raw && (
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm font-medium mb-2">メール本文</p>
              <pre className="text-xs whitespace-pre-wrap break-words text-muted-foreground max-h-48 overflow-y-auto">
                {order.source_raw}
              </pre>
            </div>
          )}

          {/* 添付ファイルパネル (メール起票時のみ) */}
          {order.source_type === 'email' && attachments && attachments.length > 0 && (
            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" />
                添付ファイル
              </p>
              <ul className="space-y-2">
                {attachments.map((att) => (
                  <li key={att.id} className="text-xs">
                    {att.parse_status === 'failed_no_attachment' ? (
                      <span className="text-muted-foreground">添付ファイルなし</span>
                    ) : att.parse_status === 'failed_encrypted' || att.parse_status === 'failed_image' ? (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        自動読み取り不可 — ファイルを直接確認してください
                        {att.signed_url && (
                          <a
                            href={att.signed_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-1 underline text-primary"
                          >
                            {att.original_filename}
                          </a>
                        )}
                      </span>
                    ) : (
                      <a
                        href={att.signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary underline"
                      >
                        <Download className="h-3 w-3 shrink-0" />
                        {att.original_filename}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* アクションボタン */}
          <div className="flex flex-wrap gap-3">
            {isDraft && (
              <div className="flex-1 space-y-1">
                <Button
                  onClick={handleSimulate}
                  disabled={simulateMutation.isPending || blocksSimulation}
                  className="w-full"
                >
                  <Calculator className="mr-2 h-4 w-4" />
                  {simulateMutation.isPending ? "計算中..." : "シミュレーション実行"}
                </Button>
                {hasNoRouting && (
                  <p className="text-xs text-muted-foreground">
                    工程が設定されていません。{" "}
                    <a
                      href={`/master/products?highlight=${order.product_id}`}
                      className="underline text-primary"
                    >
                      製品マスタから工程を設定してください。
                    </a>
                  </p>
                )}
                {hasUnconfirmedRouting && (
                  <p className="text-xs text-muted-foreground">
                    未確定の工程があります。{" "}
                    <a
                      href={`/master/products?highlight=${order.product_id}`}
                      className="underline text-primary"
                    >
                      製品マスタから工程を確定してください。
                    </a>
                  </p>
                )}
              </div>
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
        order={isEditDialogOpen ? order : null}
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
