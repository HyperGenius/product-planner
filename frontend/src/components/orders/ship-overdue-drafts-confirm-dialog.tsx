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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getProductName, formatDeadlineDate } from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface ShipOverdueDraftsConfirmDialogProps {
  open: boolean
  orders: Order[]
  products?: Product[]
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ShipOverdueDraftsConfirmDialog({
  open,
  orders,
  products,
  isPending,
  onConfirm,
  onCancel,
}: ShipOverdueDraftsConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>納期超過の下書きを送品済みにする</DialogTitle>
          <DialogDescription className="mt-1">
            希望納期を過ぎたまま残っている下書きの受注 {orders.length} 件を「送品済み」にします。
            この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>注文番号</TableHead>
                <TableHead>品名</TableHead>
                <TableHead>希望納期</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-medium">{order.order_no ?? "未設定"}</TableCell>
                  <TableCell className="text-sm">
                    {getProductName(order.product_id, products, order.extracted_product_name)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatDeadlineDate(order.desired_deadline) ?? "未設定"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            キャンセル
          </Button>
          <Button onClick={onConfirm} disabled={isPending || orders.length === 0}>
            {isPending ? "処理中..." : "送品済みにする"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
