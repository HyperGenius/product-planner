"use client"

import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { AlertTriangle, RefreshCw } from "lucide-react"

interface FloorDashboardHeaderProps {
  /** 直近のデータ取得成功時刻（未取得なら null） */
  lastUpdatedAt: Date | null
  /**
   * 直近の取得が失敗中か。常時表示画面のため、通信断・認証切れ等で
   * データが更新されなくなっていることを現場側が気づけるようにする
   */
  isError: boolean
}

/**
 * 現場ダッシュボードのヘッダー（画面タイトル＋最終更新時刻。Issue #440）。
 */
export function FloorDashboardHeader({ lastUpdatedAt, isError }: FloorDashboardHeaderProps) {
  if (isError) {
    return (
      <div className="flex items-start justify-between border-b pb-4">
        <h1 className="text-4xl font-bold tracking-tight">受注・出荷ダッシュボード</h1>
        <div className="flex items-center gap-2 text-lg text-destructive pt-2">
          <AlertTriangle className="h-5 w-5" />
          <span>
            データ取得に失敗しました。
            {lastUpdatedAt &&
              `（最終更新: ${format(lastUpdatedAt, "yyyy年M月d日（E） HH:mm:ss", { locale: ja })}）`}
          </span>
        </div>
      </div>
    )
  }

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
