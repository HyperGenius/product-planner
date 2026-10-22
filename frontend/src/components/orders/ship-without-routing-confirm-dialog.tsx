"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ShipWithoutRoutingConfirmDialogProps {
  open: boolean
  orderNo: string
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 工程未入力の下書きを送品済みにする暫定の例外処理の確認ダイアログ（Issue #547）。
 * 工程を入力できるようになれば不要になる機能。
 */
export function ShipWithoutRoutingConfirmDialog({
  open,
  orderNo,
  isPending,
  onConfirm,
  onCancel,
}: ShipWithoutRoutingConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !isPending) onCancel() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>送品済みにする（工程未入力の例外処理）</DialogTitle>
          <DialogDescription className="mt-1">
            注文「{orderNo || "未設定"}」は工程が入力されていないため、シミュレーションも承認依頼も進められません。
            工程を入力するまでの例外処理として、承認を経ずに「送品済み」にします。
            この操作は取り消せず、承認ログに記録されます。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            キャンセル
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "処理中..." : "送品済みにする"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
