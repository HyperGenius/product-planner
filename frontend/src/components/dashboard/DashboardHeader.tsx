"use client"

import { CalendarDays } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"

/**
 * ダッシュボード共通のページヘッダー（タイトル＋当日日付）。
 */
export function DashboardHeader() {
  return (
    <div className="mb-8 flex items-start justify-between">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">ダッシュボード</h1>
        <p className="text-muted-foreground mt-1">今日の生産状況をご確認ください</p>
      </div>
      <div className="text-right text-sm text-muted-foreground pt-1">
        <div className="flex items-center gap-1.5 justify-end">
          <CalendarDays className="h-4 w-4" />
          <span>{format(new Date(), "yyyy年M月d日（E）", { locale: ja })}</span>
        </div>
      </div>
    </div>
  )
}
