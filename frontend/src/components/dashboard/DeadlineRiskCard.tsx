"use client"

import { useRouter } from "next/navigation"
import { AlertTriangle, CalendarClock } from "lucide-react"
import {
  describeDeadlineRisk,
  getDeadlineRiskOrders,
} from "@/lib/deadline-risk"
import {
  formatDeadlineShort,
  getProductName,
  getStatusLabel,
} from "@/lib/order-utils"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface DeadlineRiskCardProps {
  /** DashboardRouter が1回だけ取得した注文一覧（全ステータス） */
  orders: Order[] | undefined
  products: Product[] | undefined
  ordersLoading: boolean
}

/**
 * 納期リスク注文カード（Issue #403）。
 *
 * 生産中（`confirmed` / `in_progress`）の注文のうち、計画納期が顧客希望納期を超過している
 * もの・顧客希望納期が目前のものを、リスク順（超過日数の降順 → 希望納期の昇順）で一覧する。
 * 実績進捗データが無い現状でも「計画上すでに間に合っていない／目前」の注文を社長が
 * ダッシュボードで即座に把握できるようにする。
 *
 * - リスク判定・ソートは `lib/deadline-risk.ts` の純粋関数に委譲（ユニットテスト対象）
 * - 各行: 注文番号 / 製品 × 数量 / 顧客希望納期 / 確定納期 / 超過日数 / ステータス
 * - 行クリック → `/orders/{id}`
 * - リスク0件・ロード中はカードごと非表示
 */
export function DeadlineRiskCard({
  orders,
  products,
  ordersLoading,
}: DeadlineRiskCardProps) {
  const router = useRouter()

  if (ordersLoading || !orders) return null

  const riskRows = getDeadlineRiskOrders(orders)
  if (riskRows.length === 0) return null

  return (
    <div className="mb-8 rounded-lg border border-red-300 bg-red-50/60 shadow-sm">
      <div className="flex items-center gap-3 border-b border-red-200 px-6 py-4">
        <div className="rounded-full bg-red-100 p-2.5">
          <CalendarClock className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <p className="font-semibold text-red-900">
            納期リスクのある注文が{riskRows.length}件あります
          </p>
          <p className="text-sm text-red-700">
            計画納期が希望納期を超過、または希望納期が目前の生産中注文
          </p>
        </div>
      </div>

      <div className="divide-y divide-red-200">
        {riskRows.map((row) => {
          const { order } = row
          const label = describeDeadlineRisk(row)

          return (
            <button
              key={order.id}
              type="button"
              onClick={() => router.push(`/orders/${order.id}`)}
              className="flex w-full items-center justify-between gap-4 px-6 py-3 text-left transition-colors hover:bg-red-100/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {order.order_no ?? `#${order.id}`}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    {getStatusLabel(order.status)}
                  </span>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {getProductName(
                    order.product_id,
                    products,
                    order.extracted_product_name,
                  )}{" "}
                  × {order.quantity}
                </p>
              </div>

              <div className="shrink-0 text-right text-sm">
                <p className="text-muted-foreground">
                  希望 {formatDeadlineShort(order.desired_deadline) ?? "-"} / 確定{" "}
                  {formatDeadlineShort(order.confirmed_deadline) ?? "-"}
                </p>
                <p
                  className={
                    label.severity === "overrun"
                      ? "flex items-center justify-end gap-1 font-medium text-red-600"
                      : "flex items-center justify-end gap-1 font-medium text-amber-600"
                  }
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {label.text}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
