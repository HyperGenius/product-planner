"use client"

import { Info } from "lucide-react"

/**
 * フェーズ1であることを示す注記バナー（Issue #440）。
 * 現場実績連携（フェーズ2以降）が入るまで表示し続ける想定。
 */
export function FloorDashboardPhaseBanner() {
  return (
    <div className="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <Info className="h-5 w-5 shrink-0" />
      <p className="text-base">
        フェーズ1: 計画データのみ表示中。現場実績はまだ未連携です。
      </p>
    </div>
  )
}
