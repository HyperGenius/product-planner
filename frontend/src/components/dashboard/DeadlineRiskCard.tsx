"use client"

import { useRouter } from "next/navigation"
import { AlertTriangle, CalendarClock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  describeDeadlineRisk,
  getDeadlineRiskOrders,
} from "@/lib/deadline-risk"
import {
  formatDeadlineShort,
  getCustomerDisplayName,
  getProductName,
} from "@/lib/order-utils"
import type { Customer } from "@/types/customer"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface DeadlineRiskCardProps {
  /** DashboardRouter が1回だけ取得した注文一覧（全ステータス） */
  orders: Order[] | undefined
  products: Product[] | undefined
  customers: Customer[] | undefined
  ordersLoading: boolean
}

/**
 * 納期リスク注文カード（Issue #403、レイアウト改善は Issue #454）。
 *
 * 生産中（`confirmed` / `in_progress`）の注文のうち、計画納期が顧客希望納期を超過している
 * もの・顧客希望納期が目前のものを、リスク順（超過日数の降順 → 希望納期の昇順）で一覧する。
 * 実績進捗データが無い現状でも「計画上すでに間に合っていない／目前」の注文を社長が
 * ダッシュボードで即座に把握できるようにする。
 *
 * - リスク判定・ソートは `lib/deadline-risk.ts` の純粋関数に委譲（ユニットテスト対象）
 * - 各行は1行表示: 顧客名 / 製品名 + 数量バッジ（左）／ 希望・確定納期 + 超過日数ラベル（右）。
 *   注文番号・ステータスバッジは確定日付があれば判別できるため表示しない
 * - 行ごとの文字数・桁数のばらつきでバッジ・日付・ラベルの横位置がガタつかないよう、
 *   右側3列（数量バッジ／日付／超過日数ラベル）は grid で固定幅にして右揃えする
 * - 5件を超える分はカードの高さを一定に保つため内部スクロール（`max-h` + `overflow-y-auto`）
 * - 行クリック → `/orders/{id}`
 * - リスク0件・ロード中はカードごと非表示
 */
export function DeadlineRiskCard({
  orders,
  products,
  customers,
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
        <p className="font-semibold text-red-900">
          納期リスクのある注文が{riskRows.length}件あります
        </p>
      </div>

      <div className="max-h-[220px] divide-y divide-red-200 overflow-y-auto">
        {riskRows.map((row) => {
          const { order } = row
          const label = describeDeadlineRisk(row)

          return (
            <button
              key={order.id}
              type="button"
              onClick={() => router.push(`/orders/${order.id}`)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-6 py-2.5 text-left transition-colors hover:bg-red-100/50"
            >
              <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                <span className="flex-shrink-0 text-sm font-medium text-foreground">
                  {getCustomerDisplayName(order.customer_id, customers)}
                </span>
                <span className="flex-shrink-0 text-sm text-muted-foreground">
                  /
                </span>
                <span className="truncate text-sm text-foreground">
                  {getProductName(
                    order.product_id,
                    products,
                    order.extracted_product_name,
                  )}
                </span>
              </div>

              <Badge
                variant="outline"
                className="justify-self-start font-normal"
              >
                {order.quantity != null
                  ? `${order.quantity.toLocaleString("ja-JP")} 個`
                  : "-"}
              </Badge>

              <span className="justify-self-end whitespace-nowrap text-sm text-muted-foreground">
                希望 {formatDeadlineShort(order.desired_deadline) ?? "-"} / 確定{" "}
                {formatDeadlineShort(order.confirmed_deadline) ?? "-"}
              </span>

              <span
                className={
                  label.severity === "overrun"
                    ? "flex items-center justify-self-end gap-1 whitespace-nowrap text-sm font-medium text-red-600"
                    : "flex items-center justify-self-end gap-1 whitespace-nowrap text-sm font-medium text-amber-600"
                }
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {label.text}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
