"use client"

import { useRouter } from "next/navigation"
import { formatDistanceToNow, parseISO } from "date-fns"
import { ja } from "date-fns/locale"
import { AlertTriangle, ArrowRight, BellRing } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  formatDeadlineDate,
  getProductName,
  isDeadlineOverdue,
} from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface ApprovalQueueCardProps {
  /** DashboardRouter が1回だけ取得した注文一覧（全ステータス） */
  orders: Order[] | undefined
  products: Product[] | undefined
  ordersLoading: boolean
}

/**
 * 承認待ちキューカード（Issue #402）。
 *
 * 旧「承認待ちバナー」（件数だけ表示）を、承認待ち注文の実リストに置き換える。
 * 社長がログイン直後に「誰から・いつ・何の承認を頼まれているか」を把握し、
 * そのまま承認へ進めるようにする。
 *
 * - 対象: `status === "pending_approval"` の注文
 * - 各行: 注文番号 / 製品 × 数量 / 希望納期 / シミュ納期（遅延強調）/ 依頼者 / 依頼からの経過時間
 * - 行クリック → `/orders/{id}`、見出し → `/orders?status=pending_approval`（一括承認画面）
 * - 承認待ち0件・ロード中は何も描画しない（旧バナーの挙動を踏襲）
 * - `simulated_deadline` 未算出の行は「シミュ納期なし」表示・遅延判定なし
 */
export function ApprovalQueueCard({
  orders,
  products,
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
          <div>
            <p className="font-semibold text-orange-900">
              承認待ちの注文が{pending.length}件あります
            </p>
            <p className="text-sm text-orange-700">
              クリックして一括承認画面へ
            </p>
          </div>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-orange-600" />
      </button>

      <div className="divide-y divide-orange-200">
        {pending.map((order) => {
          const overdue = isDeadlineOverdue(order, order.simulated_deadline)
          const requester = order.approval_requested_by_name ?? "依頼者不明"
          const requestedAgo = order.approval_requested_at
            ? formatDistanceToNow(parseISO(order.approval_requested_at), {
                addSuffix: true,
                locale: ja,
              })
            : "依頼時刻不明"

          return (
            <button
              key={order.id}
              type="button"
              onClick={() => router.push(`/orders/${order.id}`)}
              className="flex w-full items-center justify-between gap-4 px-6 py-3 text-left transition-colors hover:bg-orange-100/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {order.order_no ?? `#${order.id}`}
                  </span>
                  {overdue && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      <AlertTriangle className="h-3 w-3" />
                      納期遅延
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {getProductName(
                    order.product_id,
                    products,
                    order.extracted_product_name,
                  )}{" "}
                  × {order.quantity}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {requester}・{requestedAgo}
                </p>
              </div>

              <div className="shrink-0 text-right text-sm">
                <p className="text-muted-foreground">
                  希望 {formatDeadlineDate(order.desired_deadline) ?? "-"}
                </p>
                <p className={overdue ? "font-medium text-red-600" : "text-foreground"}>
                  シミュ{" "}
                  {order.simulated_deadline
                    ? formatDeadlineDate(order.simulated_deadline)
                    : "納期なし"}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex justify-end px-6 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/orders?status=pending_approval")}
          className="gap-1 text-sm text-orange-800 hover:text-orange-900"
        >
          一括承認画面へ
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
