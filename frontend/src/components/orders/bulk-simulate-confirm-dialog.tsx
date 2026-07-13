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

interface BulkSimulateConfirmDialogProps {
  open: boolean
  orders: Order[]
  products?: Product[]
  onConfirm: () => void
  onCancel: () => void
}

export function BulkSimulateConfirmDialog({
  open,
  orders,
  products,
  onConfirm,
  onCancel,
}: BulkSimulateConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>一括シミュレーションの確認</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            この順番で処理します（{orders.length}件）
          </p>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>注文番号</TableHead>
                <TableHead>品名</TableHead>
                <TableHead>希望納期</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order, index) => (
                <TableRow key={order.id}>
                  <TableCell className="text-muted-foreground font-medium">{index + 1}</TableCell>
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
          <Button variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
          <Button onClick={onConfirm}>実行</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
