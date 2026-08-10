"use client"

import { useState } from "react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDeadlineDate } from "@/lib/order-utils"
import type { BulkSimulateResult } from "@/types/order"

const PAGE_SIZE = 5

interface BulkSimulateSummaryDialogProps {
  results: BulkSimulateResult[] | null
  onClose: () => void
  onBulkRequestApproval?: (orderIds: number[]) => void
}

// 回答納期(calculated_deadline)はスケジューラが計算した実際の日時のため時刻付きで表示する
function formatDate(iso: string) {
  return format(new Date(iso), "yyyy/MM/dd HH:mm", { locale: ja })
}

export function BulkSimulateSummaryDialog({ results, onClose, onBulkRequestApproval }: BulkSimulateSummaryDialogProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [showNgOnly, setShowNgOnly] = useState(false)

  if (!results) return null

  const okCount = results.filter((r) => r.result !== null && r.result.is_feasible).length
  const infeasibleCount = results.filter((r) => r.result !== null && !r.result.is_feasible).length
  const failedCount = results.filter((r) => r.result === null).length

  const filteredResults = showNgOnly
    ? results.filter((r) => !r.result?.is_feasible)
    : results
  const totalPages = Math.max(1, Math.ceil(filteredResults.length / PAGE_SIZE))
  const pagedResults = filteredResults.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const currentPageOkIds = pagedResults
    .filter((r) => r.result !== null && r.result.is_feasible)
    .map((r) => r.orderId)

  const handleNgOnlyChange = (checked: boolean) => {
    setShowNgOnly(checked)
    setCurrentPage(1)
  }

  return (
    <Dialog open={results !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            一括シミュレーション結果（{results.length}件）　{currentPage}/{totalPages}ページ
          </DialogTitle>
          <p className="flex items-center gap-2 text-sm text-muted-foreground mt-1 flex-wrap">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              納期OK {okCount}件
            </span>
            <span className="text-muted-foreground/50">/</span>
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 text-yellow-500" />
              納期不可 {infeasibleCount}件
            </span>
            <span className="text-muted-foreground/50">/</span>
            <span className="flex items-center gap-1">
              <XCircle className="h-4 w-4 text-destructive" />
              失敗 {failedCount}件
            </span>
          </p>
        </DialogHeader>

        <div className="space-y-1 py-2">
          {pagedResults.map((r) => {
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
                className={`flex items-start gap-3 rounded-md px-3 py-2 ${rowClass}`}
              >
                {isFailed ? (
                  <XCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
                ) : isInfeasible ? (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500 mt-0.5" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500 mt-0.5" />
                )}
                <span className="text-sm font-medium shrink-0">{r.orderNo}</span>
                <div className="ml-auto text-right text-sm text-muted-foreground space-y-0.5">
                  {isFailed ? (
                    <p>シミュレーション失敗</p>
                  ) : isInfeasible ? (
                    <>
                      <p>
                        <span className="text-xs text-muted-foreground/70">希望　</span>
                        {formatDeadlineDate(r.desiredDeadline) ?? "未設定"}
                      </p>
                      <p>
                        <span className="text-xs text-muted-foreground/70">回答　</span>
                        {r.result!.calculated_deadline ? formatDate(r.result!.calculated_deadline) : "—"}
                      </p>
                    </>
                  ) : (
                    <p>
                      <span className="text-xs text-muted-foreground/70">回答　</span>
                      {r.result!.calculated_deadline ? formatDate(r.result!.calculated_deadline) : "—"}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <div className="flex items-center gap-2">
            <Checkbox
              id="ng-only"
              checked={showNgOnly}
              onCheckedChange={(v) => handleNgOnlyChange(!!v)}
            />
            <label htmlFor="ng-only" className="text-sm cursor-pointer">NGのみ表示</label>
          </div>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={currentPage <= 1}
            >
              ← 前へ
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={currentPage >= totalPages}
            >
              次へ →
            </Button>
            {onBulkRequestApproval && (
              <Button
                size="sm"
                onClick={() => onBulkRequestApproval(currentPageOkIds)}
                disabled={currentPageOkIds.length === 0}
              >
                OK分だけ承認依頼を送信
              </Button>
            )}
            <Button onClick={onClose}>閉じる</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
