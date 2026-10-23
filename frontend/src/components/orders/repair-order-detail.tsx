"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, ArrowLeft, Check, Download, Paperclip, Pencil, Trash2, Truck, Undo2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ApproveConfirmDialog } from "@/components/orders/approve-confirm-dialog"
import { CustomerCertaintyValue } from "@/components/orders/customer-certainty-value"
import { DeleteOrderDialog } from "@/components/orders/delete-order-dialog"
import { RejectOrderDialog } from "@/components/orders/reject-order-dialog"
import { RepairOrderEditDialog } from "@/components/orders/repair-order-edit-dialog"
import { RequestApprovalConfirmDialog } from "@/components/orders/request-approval-confirm-dialog"
import {
  useConfirmOrder,
  useDeleteOrder,
  useOrderAttachments,
  useRejectOrder,
  useRequestApproval,
  useShipOrder,
  useWithdrawApproval,
} from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useCustomers } from "@/hooks/use-customers"
import {
  canApproveOrder,
  canRejectOrder,
  canShipOrder,
  canWithdrawApproval,
  formatDeadlineDate,
  getCustomerName,
  getEffectiveOrderStatus,
  getRepairApprovalBlockReason,
  getStatusBadgeClass,
  getStatusLabel,
  isDeadlineOverdue,
  ORDER_TYPE_LABELS,
  usesSimulatedDeadlineForOrder,
} from "@/lib/order-utils"
import { getRepairOrderErrorMessage } from "@/lib/repair-order"
import type { Order } from "@/types/order"

interface RepairOrderDetailProps {
  order: Order
}

/**
 * 修理・メンテナンス・洗浄など、製品を持たない注文の詳細（Issue #494）。
 * 製品・数量・工程・シミュレーション・スケジュールは表示せず、件名・作業内容と日付だけを扱う。
 * 実施開始日と完了予定日が両方入るまで承認依頼できず、承認・差し戻しは生産と同じ操作
 */
export function RepairOrderDetail({ order }: RepairOrderDetailProps) {
  const router = useRouter()
  const { data: customers } = useCustomers()
  const { data: attachments } = useOrderAttachments(order.id)
  const { data: currentMember } = useCurrentMember()
  const role = currentMember?.role ?? null

  const requestApprovalMutation = useRequestApproval()
  const confirmMutation = useConfirmOrder()
  const rejectMutation = useRejectOrder()
  const withdrawMutation = useWithdrawApproval()
  const shipMutation = useShipOrder()
  const deleteMutation = useDeleteOrder()

  const [isEditOpen, setIsEditOpen] = useState(false)
  const [editGeneration, setEditGeneration] = useState(0)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [isRejectOpen, setIsRejectOpen] = useState(false)
  const [isRequestApprovalOpen, setIsRequestApprovalOpen] = useState(false)
  const [isApproveOpen, setIsApproveOpen] = useState(false)

  const isDraft = order.status === "draft"
  const approvalBlockReason = getRepairApprovalBlockReason(order)
  const usesSimulated = usesSimulatedDeadlineForOrder(order)
  const completion = usesSimulated ? order.simulated_deadline : order.confirmed_deadline
  const canDelete = order.status === "draft" || order.status === "canceled"
  const effectiveStatus = getEffectiveOrderStatus(order)

  const formatDate = (dateStr?: string | null) =>
    formatDeadlineDate(dateStr) ?? <span className="text-muted-foreground">未設定</span>

  const openEdit = () => {
    setIsEditOpen(true)
    setEditGeneration((prev) => prev + 1)
  }

  const handleRequestApproval = async () => {
    try {
      await requestApprovalMutation.mutateAsync(order.id)
      toast.success("承認依頼を送信しました")
      setIsRequestApprovalOpen(false)
    } catch (error) {
      toast.error(getRepairOrderErrorMessage(error) ?? "承認依頼の送信に失敗しました")
    }
  }

  const handleApprove = async () => {
    try {
      await confirmMutation.mutateAsync(order.id)
      toast.success("注文を承認しました")
      setIsApproveOpen(false)
      router.push("/orders?type=repair")
    } catch (error) {
      toast.error(getRepairOrderErrorMessage(error) ?? "注文の承認に失敗しました")
    }
  }

  const handleReject = async (reason: string) => {
    try {
      await rejectMutation.mutateAsync({ id: order.id, reason: reason || undefined })
      toast.success("注文を差し戻しました")
      setIsRejectOpen(false)
    } catch {
      toast.error("差し戻しに失敗しました")
    }
  }

  const handleWithdraw = async () => {
    try {
      await withdrawMutation.mutateAsync(order.id)
      toast.success("承認依頼を取り下げました")
    } catch {
      toast.error("承認依頼の取り下げに失敗しました")
    }
  }

  const handleShip = async () => {
    try {
      await shipMutation.mutateAsync(order.id)
      toast.success("送品済みにしました")
    } catch {
      toast.error("送品済みへの変更に失敗しました")
    }
  }

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(order.id)
      toast.success("注文を削除しました")
      router.back()
    } catch {
      toast.error("注文の削除に失敗しました")
    }
  }

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6 flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          戻る
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{order.order_no ?? `注文 #${order.id}`}</h1>
            <Badge className="bg-slate-100 text-slate-700 hover:bg-slate-100">
              {ORDER_TYPE_LABELS.repair}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">注文詳細</p>
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-6">
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-4">注文基本情報</h2>
          <dl className="space-y-3 text-sm">
            <div className="space-y-1">
              <dt className="text-muted-foreground">件名・作業内容</dt>
              <dd className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">
                {order.work_description?.trim() || (
                  <span className="text-muted-foreground">未設定</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">注文番号</dt>
              <dd className="font-medium">{order.order_no ?? <span className="text-muted-foreground">未設定</span>}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">顧客注文番号</dt>
              <dd>{order.customer_order_no ?? <span className="text-muted-foreground">未設定</span>}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">顧客</dt>
              <dd>
                {order.customer_id ? (
                  getCustomerName(order.customer_id, customers)
                ) : order.source_type === "email" ? (
                  <span className="text-amber-600">顧客不明（編集から顧客を選んでください）</span>
                ) : (
                  <span className="text-muted-foreground">未設定</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">受注日</dt>
              <dd>{formatDate(order.order_date ?? order.created_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">納期</dt>
              <dd>{formatDate(order.desired_deadline)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">実施開始日</dt>
              <dd>{formatDate(order.scheduling_start_date)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {usesSimulated ? "完了予定日" : "確定した完了予定日"}
              </dt>
              <dd
                className={
                  isDeadlineOverdue(order, completion) ? "font-semibold text-destructive" : undefined
                }
              >
                {formatDate(completion)}
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">ステータス</dt>
              <dd>
                <Badge className={getStatusBadgeClass(effectiveStatus)}>
                  {getStatusLabel(effectiveStatus)}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between items-center">
              <dt className="text-muted-foreground">顧客側の確度</dt>
              <dd>
                <CustomerCertaintyValue certainty={order.customer_certainty} />
              </dd>
            </div>
          </dl>
        </div>

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

        {attachments && attachments.length > 0 && (
          <div className="rounded-lg border bg-muted/50 p-4">
            <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <Paperclip className="h-3.5 w-3.5" />
              元の注文書
            </p>
            <ul className="space-y-2">
              {attachments.map((att) => (
                <li key={att.id} className="text-xs">
                  {att.parse_status === "failed_no_attachment" ? (
                    <span className="text-muted-foreground">添付ファイルなし</span>
                  ) : (
                    <span className="flex flex-col gap-0.5">
                      <a
                        href={att.signed_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary underline"
                      >
                        <Download className="h-3 w-3 shrink-0" />
                        {att.original_filename}
                      </a>
                      {att.parse_status === "success_image" && (
                        <span className="flex items-center gap-1 text-amber-600">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          画像（FAX等）から自動で読み取りました — 内容を元ファイルと照合してください
                        </span>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap gap-3">
            {isDraft && role === "order_handler" && (
              <Button
                onClick={() => setIsRequestApprovalOpen(true)}
                disabled={approvalBlockReason !== null || requestApprovalMutation.isPending}
                className="flex-1"
              >
                <Check className="mr-2 h-4 w-4" />
                {requestApprovalMutation.isPending ? "処理中..." : "承認依頼を送信"}
              </Button>
            )}
            {canWithdrawApproval(order, role) && (
              <Button
                onClick={handleWithdraw}
                disabled={withdrawMutation.isPending}
                variant="outline"
              >
                <Undo2 className="mr-2 h-4 w-4" />
                {withdrawMutation.isPending ? "処理中..." : "承認依頼を取り下げる"}
              </Button>
            )}
            {canApproveOrder(order, role) && (
              <Button
                onClick={() => setIsApproveOpen(true)}
                disabled={confirmMutation.isPending}
                className="flex-1"
              >
                <Check className="mr-2 h-4 w-4" />
                {confirmMutation.isPending ? "処理中..." : "承認"}
              </Button>
            )}
            {canRejectOrder(order, role) && (
              <Button onClick={() => setIsRejectOpen(true)} variant="outline">
                差し戻し
              </Button>
            )}
            {canShipOrder(order, role) && (
              <Button onClick={handleShip} disabled={shipMutation.isPending} className="flex-1">
                <Truck className="mr-2 h-4 w-4" />
                {shipMutation.isPending ? "処理中..." : "送品済みにする"}
              </Button>
            )}
            {isDraft && (
              <Button variant="outline" onClick={openEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                編集
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" onClick={() => setIsDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4" />
                削除
              </Button>
            )}
          </div>
          {isDraft && role === "order_handler" && approvalBlockReason && (
            <p className="text-xs text-muted-foreground">
              {approvalBlockReason}。{" "}
              <button type="button" onClick={openEdit} className="underline text-primary">
                編集から入力してください。
              </button>
            </p>
          )}
        </div>
      </div>

      <RepairOrderEditDialog
        key={editGeneration}
        order={isEditOpen ? order : null}
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
      />

      <DeleteOrderDialog
        order={isDeleteOpen ? order : null}
        customers={customers}
        isPending={deleteMutation.isPending}
        onConfirm={handleDelete}
        onOpenChange={(open) => { if (!open) setIsDeleteOpen(false) }}
      />

      <RejectOrderDialog
        order={isRejectOpen ? order : null}
        customers={customers}
        isPending={rejectMutation.isPending}
        onConfirm={handleReject}
        onOpenChange={(open) => { if (!open) setIsRejectOpen(false) }}
      />

      <RequestApprovalConfirmDialog
        order={isRequestApprovalOpen ? order : null}
        isPending={requestApprovalMutation.isPending}
        onConfirm={handleRequestApproval}
        onOpenChange={(open) => { if (!open) setIsRequestApprovalOpen(false) }}
      />

      <ApproveConfirmDialog
        order={isApproveOpen ? order : null}
        isPending={confirmMutation.isPending}
        onConfirm={handleApprove}
        onOpenChange={(open) => { if (!open) setIsApproveOpen(false) }}
      />
    </div>
  )
}
