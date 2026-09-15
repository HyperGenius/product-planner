"use client"

import type { ReactNode } from "react"

interface FloorDashboardLayoutProps {
  children: ReactNode
}

/**
 * 現場向け大型ディスプレイ表示用のフルスクリーンレイアウト（Issue #440）。
 * サイドバー・通常ヘッダーを持たず、常時表示での視認性を優先した器のみを提供する。
 * 顧客別受注情報・出荷予定表の左右独立パネル（Issue #450）が高さいっぱいに広がった上で
 * それぞれ独立スクロールできるよう、`min-h-screen` で画面全体の高さを確保しつつ
 * `min-h-0` で子要素の overflow が効くようにする。
 */
export function FloorDashboardLayout({ children }: FloorDashboardLayoutProps) {
  return (
    <div className="min-h-screen h-screen bg-background flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col gap-6 px-8 py-6 min-h-0">{children}</div>
    </div>
  )
}
