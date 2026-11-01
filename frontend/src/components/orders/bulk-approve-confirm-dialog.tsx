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
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  getOrderProductName,
  formatDeadlineDate,
  isDeadlineOverdue,
  partitionOverdueBySimulatedDeadline,
} from "@/lib/order-utils"
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
  const { sorted, overdueCount } = partitionOverdueBySimulatedDeadline(orders)

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
      <DialogContent className="flex max-h-[85dvh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>一括承認の確認</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            以下の注文を承認します（{orders.length}件）。確定後はスケジュールが作成されます。
            {overdueCount > 0 && (
              <span className="ml-1 font-semibold text-destructive">
                うち納期超過 {overdueCount}件（先頭に表示）
              </span>
            )}
          </p>
        </DialogHeader>

        {/* shadcn の Table は自前で overflow-auto の div を挟み sticky が効かないため、素の table を使う */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="whitespace-nowrap">注文番号</TableHead>
                <TableHead>品名</TableHead>
                <TableHead className="whitespace-nowrap">希望納期</TableHead>
                <TableHead className="whitespace-nowrap">シミュ納期</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((order) => (
                <TableRow
                  key={order.id}
                  className={
                    isDeadlineOverdue(order, order.simulated_deadline)
                      ? "bg-destructive/10 hover:bg-destructive/15"
                      : undefined
                  }
                >
                  <TableCell className="whitespace-nowrap font-medium">
                    {order.order_no ?? "未設定"}
                  </TableCell>
                  <TableCell className="text-sm">{getOrderProductName(order, products)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDeadlineDate(order.desired_deadline) ?? "未設定"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    <span
                      className={
                        isDeadlineOverdue(order, order.simulated_deadline)
                          ? "font-semibold text-destructive"
                          : undefined
                      }
                    >
                      {formatDeadlineDate(order.simulated_deadline) ?? "-"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
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
