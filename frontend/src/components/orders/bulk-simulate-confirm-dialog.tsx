"use client"

import { format } from "date-fns"
import { ja } from "date-fns/locale"
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
import { getProductName } from "@/lib/order-utils"
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
                  <TableCell className="text-sm">{getProductName(order.product_id, products)}</TableCell>
                  <TableCell className="text-sm">
                    {order.desired_deadline
                      ? format(new Date(order.desired_deadline), "yyyy/MM/dd HH:mm", { locale: ja })
                      : "未設定"}
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
