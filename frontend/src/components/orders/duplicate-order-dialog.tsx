"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { formatDeadlineDate, getStatusLabel } from "@/lib/order-utils"
import type { ConflictingOrder } from "@/types/order"

interface DuplicateOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 衝突先レコードの識別情報。バックエンドで解決できなかった場合は undefined（Issue #415） */
  conflictingOrder?: ConflictingOrder
  /** メール起票（複数明細）で、どの明細が重複したか（0-indexed）。それ以外の経路では undefined */
  lineItemIndex?: number
}

/**
 * 受注の重複起票時に、衝突した既存レコードの識別情報を表示するモーダル（Issue #415 PR3）。
 * 情報表示のみで、解決操作（マージ・遷移等）は今回スコープ外。
 */
export function DuplicateOrderDialog({
  open,
  onOpenChange,
  conflictingOrder,
  lineItemIndex,
}: DuplicateOrderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>重複する注文があります</DialogTitle>
          <DialogDescription>
            {lineItemIndex !== undefined && `明細 ${lineItemIndex + 1}: `}
            同じ 顧客 × 製品 × 希望納期 の注文がすでに存在するため保存できませんでした。
          </DialogDescription>
        </DialogHeader>

        {conflictingOrder && (
          <dl className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">注文番号</dt>
              <dd>{conflictingOrder.order_no ?? "未設定"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">顧客</dt>
              <dd>{conflictingOrder.customer_name ?? "未設定"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">製品</dt>
              <dd>{conflictingOrder.product_name ?? "未設定"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">数量</dt>
              <dd>{conflictingOrder.quantity ?? "-"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">希望納期</dt>
              <dd>{formatDeadlineDate(conflictingOrder.deadline_date) ?? "未設定"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">ステータス</dt>
              <dd>{getStatusLabel(conflictingOrder.status)}</dd>
            </div>
          </dl>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>閉じる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
