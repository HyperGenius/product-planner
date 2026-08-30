"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Check,
  Download,
  Paperclip,
  Pencil,
  Split,
  Trash2,
  Truck,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SimulationResult } from "@/components/simulation-result"
import { EditOrderDialog } from "@/components/orders/edit-order-dialog"
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog"
import { RejectOrderDialog } from "@/components/orders/reject-order-dialog"
import { RequestApprovalConfirmDialog } from "@/components/orders/request-approval-confirm-dialog"
import { ApproveConfirmDialog } from "@/components/orders/approve-confirm-dialog"
import { SplitOrderDialog } from "@/components/orders/split-order-dialog"
import {
  useOrder,
  useOrderAttachments,
  useSimulateOrderById,
  useConfirmOrder,
  useRequestApproval,
  useRejectOrder,
  useWithdrawApproval,
  useShipOrder,
  useDeleteOrder,
} from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import {
  getProductName,
  getCustomerName,
  getStatusLabel,
  getStatusBadgeClass,
  getCertaintyLabel,
  getCertaintyBadgeClass,
  formatDeadlineDate,
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
  const { data: currentMember } = useCurrentMember()
  const currentUserRole = currentMember?.role ?? null

  const simulateMutation = useSimulateOrderById()
  const confirmMutation = useConfirmOrder()
  const requestApprovalMutation = useRequestApproval()
  const rejectMutation = useRejectOrder()
  const withdrawMutation = useWithdrawApproval()
  const shipMutation = useShipOrder()
  const deleteMutation = useDeleteOrder()

  const [simulationResult, setSimulationResult] = useState<OrderSimulateResponse | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editDialogGeneration, setEditDialogGeneration] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isSplitDialogOpen, setIsSplitDialogOpen] = useState(false)
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false)
  const [isRequestApprovalConfirmOpen, setIsRequestApprovalConfirmOpen] = useState(false)
  const [isApproveConfirmOpen, setIsApproveConfirmOpen] = useState(false)

  const handleOpenEditDialog = () => {
    setIsEditDialogOpen(true)
    setEditDialogGeneration((prev) => prev + 1)
  }

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
      } else if (
        error instanceof ApiError &&
        error.status === 422 &&
        error.errorCode === "routing_unconfirmed"
      ) {
        toast.error("未確定の工程があるため、シミュレーションを実行できません。", {
          description: "製品マスタから工程を確定してください。",
          action: {
            label: "工程を確定する",
            onClick: () => router.push("/master/products"),
          },
        })
      } else if (
        error instanceof ApiError &&
        error.status === 422 &&
        error.errorCode === "product_unmatched"
      ) {
        toast.error("製品が未確定のため、シミュレーションを実行できません。", {
          description: "編集から正しい製品を選択してください。",
        })
      } else {
        toast.error("シミュレーションに失敗しました")
      }
    }
  }

  const handleRequestApproval = async () => {
    try {
      await requestApprovalMutation.mutateAsync(orderId)
      toast.success("承認依頼を送信しました")
      setIsRequestApprovalConfirmOpen(false)
    } catch {
      toast.error("承認依頼の送信に失敗しました")
    }
  }

  // 承認・承認依頼は受注ステータスを不可逆に進める重要な操作のため、
  // 実行前に必ず確認モーダルを挟む（Issue #338）。差し戻し理由が残っている場合の
  // 表示もこのモーダルに統合する（Issue #326 E2Eフィードバック）
  const handleRequestApprovalClick = () => setIsRequestApprovalConfirmOpen(true)

  const handleApprove = async () => {
    try {
      await confirmMutation.mutateAsync(orderId)
      toast.success("注文を承認しました")
      setIsApproveConfirmOpen(false)
      router.push("/orders")
    } catch {
      toast.error("注文の承認に失敗しました")
    }
  }

  const handleApproveClick = () => setIsApproveConfirmOpen(true)

  const handleReject = async (reason: string) => {
    try {
      await rejectMutation.mutateAsync({ id: orderId, reason: reason || undefined })
      toast.success("注文を差し戻しました")
      setIsRejectDialogOpen(false)
    } catch {
      toast.error("差し戻しに失敗しました")
    }
  }

  const handleWithdraw = async () => {
    try {
      await withdrawMutation.mutateAsync(orderId)
      toast.success("承認依頼を取り下げました")
    } catch {
      toast.error("承認依頼の取り下げに失敗しました")
    }
  }

  const handleShip = async () => {
    try {
      await shipMutation.mutateAsync(orderId)
      toast.success("送品済みにしました")
    } catch {
      toast.error("送品済みへの変更に失敗しました")
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
    return formatDeadlineDate(dateStr) ?? <span className="text-muted-foreground">未設定</span>
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
  const isPendingApproval = order.status === "pending_approval"
  const canShip =
    order.status === "confirmed" &&
    (currentUserRole === "president" || currentUserRole === "order_handler")
  const canDelete = order.status === "draft" || order.status === "canceled"
  // 自動起票で製品を識別できなかった明細（product_id === null）は、
  // has_no_routings も併せて true になるため、工程未登録の警告と二重表示
  // されないよう hasNoRouting/hasUnconfirmedRouting からは除外する
  const hasUnmatchedProduct = order.product_id === null
  const hasNoRouting =
    order.has_no_routings === true && !order.is_scheduled && !hasUnmatchedProduct
  const hasUnconfirmedRouting =
    order.has_unconfirmed_routings === true &&
    !hasNoRouting &&
    !order.is_scheduled &&
    !hasUnmatchedProduct
  const blocksSimulation = hasUnmatchedProduct || hasNoRouting || hasUnconfirmedRouting

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
                <dd>{getProductName(order.product_id, products, order.extracted_product_name)}</dd>
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

          {/* 差し戻し理由パネル (draft かつ 直近に差し戻された場合のみ) */}
          {isDraft && order.rejection_reason && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                差し戻し理由
              </p>
              <p className="text-sm text-amber-900 mt-1 whitespace-pre-wrap">
                {order.rejection_reason}
              </p>
            </div>
          )}

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
                {hasUnmatchedProduct && (
                  <p className="text-xs text-muted-foreground">
                    製品を自動識別できませんでした
                    {order.extracted_product_name && (
                      <>（抽出テキスト: 「{order.extracted_product_name}」）</>
                    )}
                    。{" "}
                    <button
                      type="button"
                      onClick={handleOpenEditDialog}
                      className="underline text-primary"
                    >
                      編集から正しい製品を選択してください。
                    </button>
                  </p>
                )}
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
            {isDraft && order.is_scheduled && currentUserRole === "order_handler" && (
              <Button
                onClick={handleRequestApprovalClick}
                disabled={requestApprovalMutation.isPending}
                variant="default"
                className="flex-1"
              >
                <Check className="mr-2 h-4 w-4" />
                {requestApprovalMutation.isPending ? "処理中..." : "承認依頼を送信"}
              </Button>
            )}
            {isPendingApproval && currentUserRole === "order_handler" && (
              <Button
                onClick={handleWithdraw}
                disabled={withdrawMutation.isPending}
                variant="outline"
              >
                <Undo2 className="mr-2 h-4 w-4" />
                {withdrawMutation.isPending ? "処理中..." : "承認依頼を取り下げる"}
              </Button>
            )}
            {isPendingApproval && currentUserRole === "president" && (
              <>
                <Button
                  onClick={handleApproveClick}
                  disabled={confirmMutation.isPending}
                  variant="default"
                  className="flex-1"
                >
                  <Check className="mr-2 h-4 w-4" />
                  {confirmMutation.isPending ? "処理中..." : "承認"}
                </Button>
                <Button
                  onClick={() => setIsRejectDialogOpen(true)}
                  variant="outline"
                >
                  差し戻し
                </Button>
              </>
            )}
            {canShip && (
              <Button
                onClick={handleShip}
                disabled={shipMutation.isPending}
                variant="default"
                className="flex-1"
              >
                <Truck className="mr-2 h-4 w-4" />
                {shipMutation.isPending ? "処理中..." : "送品済みにする"}
              </Button>
            )}
            {isDraft && (
              <Button
                variant="outline"
                onClick={handleOpenEditDialog}
              >
                <Pencil className="mr-2 h-4 w-4" />
                編集
              </Button>
            )}
            {isDraft && order.source_type === "email" && order.source_attachment_id && (
              <Button
                variant="outline"
                onClick={() => setIsSplitDialogOpen(true)}
              >
                <Split className="mr-2 h-4 w-4" />
                分割
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
        key={editDialogGeneration}
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

      <SplitOrderDialog
        order={isSplitDialogOpen ? order : null}
        open={isSplitDialogOpen}
        onOpenChange={setIsSplitDialogOpen}
        onSplit={() => router.push("/orders")}
      />

      <RejectOrderDialog
        order={isRejectDialogOpen ? order : null}
        products={products}
        customers={customers}
        isPending={rejectMutation.isPending}
        onConfirm={handleReject}
        onOpenChange={(open) => { if (!open) setIsRejectDialogOpen(false) }}
      />

      <RequestApprovalConfirmDialog
        order={isRequestApprovalConfirmOpen ? order : null}
        products={products}
        isPending={requestApprovalMutation.isPending}
        onConfirm={handleRequestApproval}
        onOpenChange={(open) => { if (!open) setIsRequestApprovalConfirmOpen(false) }}
      />

      <ApproveConfirmDialog
        order={isApproveConfirmOpen ? order : null}
        products={products}
        isPending={confirmMutation.isPending}
        onConfirm={handleApprove}
        onOpenChange={(open) => { if (!open) setIsApproveConfirmOpen(false) }}
      />
    </div>
  )
}
