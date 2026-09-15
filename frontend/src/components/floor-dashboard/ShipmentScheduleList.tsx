"use client"

import { useMemo } from "react"
import { format, parseISO } from "date-fns"
import { ja } from "date-fns/locale"
import type { Schedule } from "@/types/schedule"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"
import { getProductDisplayParts, getCustomerDisplayName, jstTodayIso } from "@/lib/order-utils"
import {
  IN_PRODUCTION_STATUSES,
  toJstDateIso,
  getEffectiveDeadline,
  getDeadlineStatus,
  matchesSearchText,
  type OrderSearchFilters,
} from "@/lib/floor-dashboard-utils"
import { QuantityBadge } from "@/components/floor-dashboard/PlanValueBadges"

export interface ShipmentScheduleRow {
  orderId: number
  orderNumber?: string
  customerName: string
  productPrimary: string
  productSecondary?: string | null
  equipmentName: string
  quantity: number | null
}

export interface ShipmentScheduleGroup {
  dateIso: string
  rows: ShipmentScheduleRow[]
}

/**
 * 生産スケジュールを最終工程（同一注文内で `end_datetime` が最も遅い工程）の完了予定日で
 * 日付ごとにグループ化する（Issue #443）。ホワイトボードの「出荷予定表」の置き換えのため、
 * 1行＝1注文（最終工程の使用設備・注文の計画数量）とする。
 *
 * `orders` に一致する注文が見つかる場合は `IN_PRODUCTION_STATUSES`（confirmed / in_progress）
 * 以外を除外する。一致しない場合（データ不整合等）はスケジュール側の非正規化データのみで表示する
 * （「ないものをあるように見せない」原則により、サイレントに消さない）。
 *
 * 検索語・「納期遅れのみ」フィルタ（Issue #444）は一致する注文が見つかる行にのみ適用する
 * （一致する注文が無い行は判定材料が無いため、`overdueOnly` 時は除外・検索時はスケジュール側の
 * 非正規化データ（`order_number` / `product_name`）で判定する）。
 */
export function groupSchedulesByShipmentDate(
  schedules: Schedule[] | undefined,
  orders: Order[] | undefined,
  products: Product[] | undefined,
  customers?: Customer[],
  filters: OrderSearchFilters = { searchText: "", overdueOnly: false },
  todayIso: string = jstTodayIso(),
): ShipmentScheduleGroup[] {
  const schedulesByOrderId = new Map<number, Schedule[]>()
  for (const schedule of schedules ?? []) {
    const existing = schedulesByOrderId.get(schedule.order_id)
    if (existing) {
      existing.push(schedule)
    } else {
      schedulesByOrderId.set(schedule.order_id, [schedule])
    }
  }

  const ordersById = new Map<number, Order>()
  for (const order of orders ?? []) {
    ordersById.set(order.id, order)
  }

  const groupsByDate = new Map<string, ShipmentScheduleRow[]>()
  for (const [orderId, orderSchedules] of schedulesByOrderId) {
    const finalSchedule = orderSchedules.reduce((latest, current) =>
      new Date(current.end_datetime) > new Date(latest.end_datetime) ? current : latest,
    )

    const order = ordersById.get(orderId)
    if (order && !IN_PRODUCTION_STATUSES.includes(order.status)) {
      continue
    }

    if (filters.overdueOnly) {
      if (!order) continue
      const status = getDeadlineStatus(getEffectiveDeadline(order), todayIso)
      if (status !== "overdue") continue
    }

    const product = order
      ? getProductDisplayParts(order.product_id, products, order.extracted_product_name)
      : { primary: finalSchedule.product_name ?? "不明", secondary: null }

    const customerName =
      order?.customer_id != null ? getCustomerDisplayName(order.customer_id, customers) : null

    const matches = matchesSearchText(filters.searchText, {
      customerName,
      productPrimary: product.primary,
      productSecondary: product.secondary,
      orderNumber: finalSchedule.order_number ?? order?.order_no ?? null,
    })
    if (!matches) continue

    const row: ShipmentScheduleRow = {
      orderId,
      orderNumber: finalSchedule.order_number ?? order?.order_no ?? undefined,
      customerName: customerName ?? "顧客未設定",
      productPrimary: product.primary,
      productSecondary: product.secondary,
      equipmentName: finalSchedule.equipment_name ?? "未設定",
      quantity: order?.quantity ?? null,
    }

    const dateIso = toJstDateIso(finalSchedule.end_datetime)
    const existing = groupsByDate.get(dateIso)
    if (existing) {
      existing.push(row)
    } else {
      groupsByDate.set(dateIso, [row])
    }
  }

  const groups = Array.from(groupsByDate.entries()).map(([dateIso, rows]) => ({
    dateIso,
    rows: rows.sort((a, b) => a.productPrimary.localeCompare(b.productPrimary, "ja")),
  }))
  groups.sort((a, b) => a.dateIso.localeCompare(b.dateIso))
  return groups
}

function formatSectionDate(dateIso: string): string {
  return format(parseISO(dateIso), "M/d(E)", { locale: ja })
}

interface ShipmentScheduleListProps {
  schedules: Schedule[] | undefined
  orders: Order[] | undefined
  products: Product[] | undefined
  customers?: Customer[]
  isLoading: boolean
  filters?: OrderSearchFilters
}

/**
 * 現場ダッシュボードの出荷予定表エリア（Issue #443）。
 * ホワイトボードの「出荷予定表」欄の置き換え。`GET /production-schedules` を最終工程の
 * 完了予定日でグルーピングして日付ごとに表示する。検索語・「納期遅れのみ」フィルタ（Issue #444）にも対応する。
 * 各行は「注文番号・顧客名・数量」を中心に、どの製品をどの会社へ何個出荷するかが一目で
 * わかる表示にする（Issue #452）。当日（JST基準）の日付セクションは他日と視覚的に区別する（Issue #452）。
 * 実績「未報告」バッジ（`UnreportedActualBadge`）は Phase 1 では非表示にする方針（Issue #450）。
 * フェーズ2（実績入力、Issue #438）で実績表示を導入する際に改めて組み込む想定のため、
 * コンポーネント自体は削除せず残してある。
 */
export function ShipmentScheduleList({
  schedules,
  orders,
  products,
  customers,
  isLoading,
  filters = { searchText: "", overdueOnly: false },
}: ShipmentScheduleListProps) {
  const todayIso = jstTodayIso()
  const groups = useMemo(
    () => groupSchedulesByShipmentDate(schedules, orders, products, customers, filters, todayIso),
    [schedules, orders, products, customers, filters, todayIso],
  )

  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm h-full flex flex-col overflow-hidden">
      <h2 className="text-2xl font-bold mb-4 shrink-0">出荷予定表</h2>
      {isLoading ? (
        <p className="text-muted-foreground">読み込み中…</p>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground">
          {filters.searchText || filters.overdueOnly
            ? "条件に一致する出荷予定はありません"
            : "出荷予定はありません"}
        </p>
      ) : (
        <div className="space-y-6 overflow-y-auto flex-1 min-h-0">
          {groups.map((group) => {
            const isToday = group.dateIso === todayIso
            return (
              <div
                key={group.dateIso}
                className={`rounded-md border ${isToday ? "border-primary" : "border-border"}`}
              >
                <h3
                  className={`text-lg font-semibold px-4 py-2 border-b flex items-center gap-2 ${
                    isToday
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-muted/50"
                  }`}
                >
                  {formatSectionDate(group.dateIso)}
                  {isToday && (
                    <span className="text-xs font-normal rounded-full bg-primary-foreground/20 px-2 py-0.5">
                      本日
                    </span>
                  )}
                </h3>
                <ul className="divide-y divide-border">
                  {group.rows.map((row) => (
                    <li
                      key={row.orderId}
                      className="px-4 py-3 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {row.orderNumber && (
                            <span className="mr-3 font-mono text-sm text-muted-foreground">
                              {row.orderNumber}
                            </span>
                          )}
                          {row.customerName}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {row.productPrimary}
                          {row.productSecondary && <span className="ml-2">{row.productSecondary}</span>}
                          <span className="ml-2">{row.equipmentName}</span>
                        </p>
                      </div>
                      <QuantityBadge quantity={row.quantity} />
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
