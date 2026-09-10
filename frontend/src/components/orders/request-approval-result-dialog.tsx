"use client"

import { CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getProductName, getCustomerName, formatDeadlineDate } from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

interface RequestApprovalResultDialogProps {
  /** 承認依頼が成功した注文。null の間はダイアログを閉じておく */
  order: Order | null
  products?: Product[]
  customers?: Customer[]
  onOpenChange: (open: boolean) => void
}

/**
 * 注文一覧ページで承認依頼の送信に成功したときに表示する結果モーダル（Issue #426）。
 * 従来はトースト（`注文「{order_no}」の承認依頼を送信しました`）だったが、
 * order_no 未設定の注文で「」内が空欄になるうえ、送信内容を後から確認できなかった。
 * 依頼した注文の主要項目（注文番号・顧客・製品・数量・希望納期・シミュ納期）を一覧で見せる。
 */
export function RequestApprovalResultDialog({
  order,
  products,
  customers,
  onOpenChange,
}: RequestApprovalResultDialogProps) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => { if (!open) onOpenChange(open) }}>
      {order && (
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-green-600" aria-hidden />
              承認依頼を送信しました
            </DialogTitle>
            <DialogDescription>
              承認者（president）に通知が送信されました。以下の内容で承認依頼を受け付けています。
            </DialogDescription>
          </DialogHeader>

          <dl className="rounded-md border p-4 text-sm space-y-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground shrink-0">注文番号</dt>
              <dd className="text-right break-all">{order.order_no ?? "未設定"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground shrink-0">顧客</dt>
              <dd className="text-right break-all">
                {order.customer_id ? getCustomerName(order.customer_id, customers) : "未設定"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground shrink-0">製品</dt>
              <dd className="text-right break-all">
                {getProductName(order.product_id, products, order.extracted_product_name)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground shrink-0">数量</dt>
              <dd className="text-right break-all">{order.quantity ?? "未設定"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground shrink-0">希望納期</dt>
              <dd className="text-right break-all">
                {formatDeadlineDate(order.desired_deadline) ?? "未設定"}
              </dd>
            </div>
            {order.simulated_deadline && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground shrink-0">シミュ納期</dt>
                <dd className="text-right break-all">
                  {formatDeadlineDate(order.simulated_deadline)}
                </dd>
              </div>
            )}
          </dl>

          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
