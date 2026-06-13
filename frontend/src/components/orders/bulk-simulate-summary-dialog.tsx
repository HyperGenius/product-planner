"use client"

import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { BulkSimulateResult } from "@/types/order"

interface BulkSimulateSummaryDialogProps {
  results: BulkSimulateResult[] | null
  onClose: () => void
}

export function BulkSimulateSummaryDialog({ results, onClose }: BulkSimulateSummaryDialogProps) {
  if (!results) return null

  const okCount = results.filter((r) => r.result !== null && r.result.is_feasible).length
  const infeasibleCount = results.filter((r) => r.result !== null && !r.result.is_feasible).length
  const failedCount = results.filter((r) => r.result === null).length

  return (
    <Dialog open={results !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>一括シミュレーション結果</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            納期OK {okCount}件 / 納期不可 {infeasibleCount}件 / 失敗 {failedCount}件
          </p>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto space-y-1 py-2">
          {results.map((r) => {
            const isFailed = r.result === null
            const isInfeasible = r.result !== null && !r.result.is_feasible
            const rowClass = isFailed
              ? "bg-destructive/10"
              : isInfeasible
              ? "bg-yellow-500/10"
              : ""

            return (
              <div
                key={r.orderId}
                className={`flex items-center gap-3 rounded-md px-3 py-2 ${rowClass}`}
              >
                {isFailed ? (
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                ) : isInfeasible ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                )}
                <span className="text-sm font-medium">{r.orderNo}</span>
                <span className="ml-auto text-sm text-muted-foreground">
                  {isFailed
                    ? "シミュレーション失敗"
                    : format(new Date(r.result!.calculated_deadline), "yyyy/MM/dd HH:mm", { locale: ja })}
                </span>
              </div>
            )
          })}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>閉じる</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
