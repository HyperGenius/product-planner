"use client"

import type { ReactNode } from "react"

interface FloorDashboardLayoutProps {
  children: ReactNode
}

/**
 * 現場向け大型ディスプレイ表示用のフルスクリーンレイアウト（Issue #440）。
 * サイドバー・通常ヘッダーを持たず、常時表示での視認性を優先した器のみを提供する。
 * 後続Issue（KPI・検索/フィルタ・顧客別受注情報・出荷予定表）はこの中に差し込む想定。
 */
export function FloorDashboardLayout({ children }: FloorDashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col gap-6 px-8 py-6">{children}</div>
    </div>
  )
}
