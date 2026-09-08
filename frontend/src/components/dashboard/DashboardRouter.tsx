"use client"

import { useCurrentMember } from "@/hooks/use-tenant-members"
import { DefaultDashboard } from "./DefaultDashboard"
import { PresidentDashboard } from "./PresidentDashboard"

/**
 * ロール別にダッシュボードを出し分ける（Issue #401）。
 *
 * - `role === "president"` のとき PresidentDashboard
 * - それ以外・`currentMember` 未取得（ローディング）中は DefaultDashboard をフォールバック表示
 *
 * 初回描画で president → PresidentDashboard へ切り替わる際のちらつきはスケルトンなしで許容する。
 */
export function DashboardRouter() {
  const { data: currentMember } = useCurrentMember()

  if (currentMember?.role === "president") {
    return <PresidentDashboard />
  }

  return <DefaultDashboard />
}
