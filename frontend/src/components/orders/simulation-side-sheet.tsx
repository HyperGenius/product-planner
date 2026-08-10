"use client"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { SimulationResult } from "@/components/simulation-result"
import type { Order, OrderSimulateResponse } from "@/types/order"

interface SimulationSideSheetProps {
  open: boolean
  order: Order | null
  result: OrderSimulateResponse | null
  requestApprovalIsPending: boolean
  currentUserRole: string | null
  onClose: () => void
  onRequestApproval: (orderId: number, orderNo: string) => void
}

export function SimulationSideSheet({
  open,
  order,
  result,
  requestApprovalIsPending,
  currentUserRole,
  onClose,
  onRequestApproval,
}: SimulationSideSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <SheetContent side="right" className="flex flex-col w-[480px] sm:max-w-[480px] p-0">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle>シミュレーション結果</SheetTitle>
          {order && (
            <p className="text-sm text-muted-foreground">注文番号: {order.order_no}</p>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <SimulationResult
            result={result}
            desiredDeadline={order?.desired_deadline}
          />
        </div>
        <SheetFooter className="px-6 py-4 border-t shrink-0 flex flex-row justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            閉じる
          </Button>
          {currentUserRole === "order_handler" && (
            <Button
              disabled={requestApprovalIsPending || !order}
              onClick={() => {
                if (order) onRequestApproval(order.id, order.order_no ?? '')
              }}
            >
              承認依頼を送信
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
