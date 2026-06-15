"use client"

import { AlertTriangle, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface BulkActionBarProps {
  selectedCount: number
  selectedScheduledCount: number
  isBulkSimulating: boolean
  isBulkConfirming: boolean
  onBulkSimulate: () => void
  onBulkConfirm: () => void
  onClearSelection: () => void
}

export function BulkActionBar({
  selectedCount,
  selectedScheduledCount,
  isBulkSimulating,
  isBulkConfirming,
  onBulkSimulate,
  onBulkConfirm,
  onClearSelection,
}: BulkActionBarProps) {
  if (selectedCount === 0) return null

  const isBusy = isBulkSimulating || isBulkConfirming
  const canConfirm = selectedScheduledCount > 0
  const BULK_SIMULATE_WARN_THRESHOLD = 20

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg">
      <span className="text-sm font-medium text-muted-foreground">
        {selectedCount}件選択中
      </span>
      {selectedCount > BULK_SIMULATE_WARN_THRESHOLD && (
        <span className="flex items-center gap-1 text-xs text-yellow-600">
          <AlertTriangle className="h-3 w-3" />
          結果確認に時間がかかる場合があります
        </span>
      )}
      <div className="h-4 w-px bg-border" />
      <Button size="sm" variant="outline" onClick={onBulkSimulate} disabled={isBusy}>
        {isBulkSimulating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            シミュレーション中...
          </>
        ) : (
          `一括シミュレーション（${selectedCount}件）`
        )}
      </Button>
      {/* disabled な Button は pointer-events: none のため Tooltip が発火しない。span でラップする */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={!canConfirm ? "cursor-not-allowed" : undefined}>
            <Button
              size="sm"
              onClick={onBulkConfirm}
              disabled={isBusy || !canConfirm}
            >
              {isBulkConfirming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  確定中...
                </>
              ) : (
                `一括確定（${selectedScheduledCount}件）`
              )}
            </Button>
          </span>
        </TooltipTrigger>
        {!canConfirm && (
          <TooltipContent>
            シミュレーション済みの注文がありません
          </TooltipContent>
        )}
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearSelection}
            disabled={isBusy}
            className="h-8 w-8 p-0"
            aria-label="選択を解除"
          >
            <X className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>選択を解除してバーを閉じる</TooltipContent>
      </Tooltip>
    </div>
  )
}
