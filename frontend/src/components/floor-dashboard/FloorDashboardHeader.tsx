"use client"

import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { RefreshCw } from "lucide-react"

interface FloorDashboardHeaderProps {
  /** 直近のデータ取得成功時刻（未取得なら null） */
  lastUpdatedAt: Date | null
}

/**
 * 現場ダッシュボードのヘッダー（画面タイトル＋最終更新時刻。Issue #440）。
 */
export function FloorDashboardHeader({ lastUpdatedAt }: FloorDashboardHeaderProps) {
  return (
    <div className="flex items-start justify-between border-b pb-4">
      <h1 className="text-4xl font-bold tracking-tight">受注・出荷ダッシュボード</h1>
      <div className="flex items-center gap-2 text-lg text-muted-foreground pt-2">
        <RefreshCw className="h-5 w-5" />
        <span>
          最終更新:{" "}
          {lastUpdatedAt
            ? format(lastUpdatedAt, "yyyy年M月d日（E） HH:mm:ss", { locale: ja })
            : "取得中..."}
        </span>
      </div>
    </div>
  )
}
