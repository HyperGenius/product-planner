"use client"

import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowRight, BellRing } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { diffDaysIso } from "@/lib/deadline-risk"
import {
  formatDeadlineShort,
  getCustomerDisplayName,
  getProductName,
  isValidIsoDate,
} from "@/lib/order-utils"
import type { Customer } from "@/types/customer"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface ApprovalQueueCardProps {
  /** DashboardRouter が1回だけ取得した注文一覧（全ステータス） */
  orders: Order[] | undefined
  products: Product[] | undefined
  customers: Customer[] | undefined
  ordersLoading: boolean
}

/**
 * 承認待ちキューカード（Issue #402、レイアウト改善は Issue #456）。
 *
 * 旧「承認待ちバナー」（件数だけ表示）を、承認待ち注文の実リストに置き換える。
 * 社長がログイン直後に承認待ちの注文を把握し、そのまま承認へ進めるようにする。
 *
 * - 対象: `status === "pending_approval"` の注文
 * - 各行は1行表示（`DeadlineRiskCard` と同様のグリッドレイアウト・Issue #454）:
 *   顧客名 / 製品名（左）／ 数量バッジ／ 希望・シミュ納期／ 超過日数ラベル（右の3列は固定幅で右揃え）
 * - 「納期超過」は `simulated_deadline > desired_deadline` の単純な条件（承認待ちはまだ
 *   確定していないため、確定納期ではなくシミュ納期で判定する）。超過日数は
 *   `diffDaysIso`（`lib/deadline-risk.ts`）で算出し、「N日超過」で表示する
 * - 導線: 行クリック → `/orders/{id}`、ヘッダー行クリック → `/orders?status=pending_approval`
 *   （一括承認画面。旧実装にあった下部の「一括承認画面へ」ボタンはヘッダーと導線が
 *   重複するため削除した）
 * - 承認待ち0件・ロード中は何も描画しない（旧バナーの挙動を踏襲）
 */
export function ApprovalQueueCard({
  orders,
  products,
  customers,
  ordersLoading,
}: ApprovalQueueCardProps) {
  const router = useRouter()

  if (ordersLoading || !orders) return null

  const pending = orders.filter((o) => o.status === "pending_approval")
  if (pending.length === 0) return null

  return (
    <div className="mb-8 rounded-lg border border-orange-300 bg-orange-50/60 shadow-sm">
      <button
        type="button"
        onClick={() => router.push("/orders?status=pending_approval")}
        className="flex w-full items-center justify-between gap-4 border-b border-orange-200 px-6 py-4 text-left transition-colors hover:bg-orange-100/60"
      >
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-orange-100 p-2.5">
            <BellRing className="h-5 w-5 text-orange-600" />
          </div>
          <p className="font-semibold text-orange-900">
            承認待ちの注文が{pending.length}件あります
          </p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-orange-600" />
      </button>

      <div className="divide-y divide-orange-200">
        {pending.map((order) => {
          const desired = order.desired_deadline?.slice(0, 10)
          const simulated = order.simulated_deadline?.slice(0, 10)
          const overrunDays =
            desired &&
            simulated &&
            isValidIsoDate(desired) &&
            isValidIsoDate(simulated)
              ? diffDaysIso(desired, simulated)
              : 0
          const overdue = overrunDays > 0

          return (
            <button
              key={order.id}
              type="button"
              onClick={() => router.push(`/orders/${order.id}`)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-orange-100/50"
            >
              <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                <span className="flex-shrink-0 text-sm font-medium text-foreground">
                  {customers ? getCustomerDisplayName(order.customer_id, customers) : "-"}
                </span>
                <span className="flex-shrink-0 text-sm text-muted-foreground">/</span>
                <span className="truncate text-sm text-foreground">
                  {getProductName(
                    order.product_id,
                    products,
                    order.extracted_product_name,
                  )}
                </span>
              </div>

              <Badge variant="outline" className="justify-self-end font-normal">
                {order.quantity != null ? `${order.quantity.toLocaleString("ja-JP")} 個` : "-"}
              </Badge>

              <span className="justify-self-end whitespace-nowrap text-sm text-muted-foreground">
                希望 {formatDeadlineShort(order.desired_deadline) ?? "-"} / シミュ{" "}
                {formatDeadlineShort(order.simulated_deadline) ?? "-"}
              </span>

              {overdue ? (
                <span className="flex items-center justify-self-end gap-1 whitespace-nowrap text-sm font-medium text-red-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {overrunDays}日超過
                </span>
              ) : (
                <span />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
