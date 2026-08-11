"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
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

interface BulkApproveConfirmDialogProps {
  open: boolean
  orders: Order[]
  products?: Product[]
  isPending: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function BulkApproveConfirmDialog({
  open,
  orders,
  products,
  isPending,
  onConfirm,
  onCancel,
}: BulkApproveConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>一括承認の確認</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            以下の注文を承認します（{orders.length}件）。確定後はスケジュールが作成されます。
          </p>
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
                  <TableCell className="font-medium">{order.order_no}</TableCell>
                  <TableCell className="text-sm">{getProductName(order.product_id, products, order.extracted_product_name)}</TableCell>
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
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "承認中..." : "承認する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
