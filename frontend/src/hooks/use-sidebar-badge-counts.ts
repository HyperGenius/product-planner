"use client"

import { useOrders } from "@/hooks/use-orders"
import { getIntakeCategory } from "@/lib/order-utils"

/**
 * サイドバーのサブメニューに出す件数バッジの種類（Epic #553）。
 * #556（承認）・#557（送品の消し込み）で種類を足すときは、ここと `useSidebarBadgeCounts()` を揃えて更新する
 */
export type SidebarBadgeKey = "intake_drafts"

/**
 * サイドバーの件数バッジの値。`keys` が空（そのロールにバッジを出す項目が無い）なら注文を取得しない
 *
 * @param keys 出すバッジの種類
 */
export function useSidebarBadgeCounts(
  keys: readonly SidebarBadgeKey[]
): Partial<Record<SidebarBadgeKey, number>> {
  const needsOrders = keys.includes("intake_drafts")
  const { data: orders } = useOrders({ enabled: needsOrders })

  // 他の画面で取得済みの注文がキャッシュにあっても、求められていないバッジは返さない
  if (!needsOrders || !orders) return {}
  return {
    intake_drafts: orders.filter((o) => getIntakeCategory(o) !== null).length,
  }
}
