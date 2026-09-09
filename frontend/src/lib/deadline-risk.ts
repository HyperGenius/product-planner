import { isValidIsoDate, jstTodayIso } from "@/lib/order-utils"
import type { Order } from "@/types/order"

/**
 * 顧客希望納期までの残日数がこの日数以内なら「納期が目前」としてリスク対象に含める（Issue #403）。
 * `0` は「顧客希望納期が今日または過去」を意味する。閾値の調整はこの定数1箇所だけで行う。
 */
export const RISK_DEADLINE_BUFFER_DAYS = 0

/**
 * 納期リスク注文カードの対象ステータス。生産中（`confirmed` / `in_progress`）のみ。
 * `in_progress` は Issue #400 で新設された「着手済み」の状態。
 */
const RISK_TARGET_STATUSES: readonly Order["status"][] = ["confirmed", "in_progress"]

export interface DeadlineRiskOrder {
  order: Order
  /**
   * `confirmed_deadline - desired_deadline` の日数。
   * 正 = 計画納期が顧客希望納期を超過。0 以下 = 残日数条件だけで入った行。
   */
  overrunDays: number
  /**
   * `desired_deadline - today` の日数。
   * 0 = 今日が希望納期、負 = 希望納期を過ぎている。
   */
  daysUntilDeadline: number
}

/**
 * "YYYY-MM-DD" 同士の日数差（`toIso - fromIso`）を端末タイムゾーン非依存で返す。
 * 両端を UTC 深夜として解釈するため、`new Date("YYYY-MM-DD")` のような日付ズレは起きない。
 */
function diffDaysIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`)
  const to = Date.parse(`${toIso}T00:00:00Z`)
  return Math.round((to - from) / 86_400_000)
}

/**
 * 生産中の注文から「納期リスク注文」を抽出し、リスク順に整列して返す（Issue #403）。
 *
 * 対象: `status` が `confirmed` / `in_progress` で、`confirmed_deadline` と `desired_deadline`
 * がともに有効な日付。いずれか未設定・不正日付の注文は除外する。
 *
 * リスク条件（OR）:
 * - `confirmed_deadline > desired_deadline`（計画納期が顧客希望納期を超過）
 * - `desired_deadline - today <= bufferDays`（顧客希望納期までの残日数が閾値以内）
 *
 * ソート: 超過日数の降順 → 顧客希望納期（`desired_deadline`）の昇順。
 */
export function getDeadlineRiskOrders(
  orders: Order[] | undefined,
  todayIso: string = jstTodayIso(),
  bufferDays: number = RISK_DEADLINE_BUFFER_DAYS,
): DeadlineRiskOrder[] {
  if (!orders) return []

  const rows: DeadlineRiskOrder[] = []
  for (const order of orders) {
    if (!(RISK_TARGET_STATUSES as string[]).includes(order.status)) continue

    const confirmed = order.confirmed_deadline?.slice(0, 10)
    const desired = order.desired_deadline?.slice(0, 10)
    if (!confirmed || !desired) continue
    if (!isValidIsoDate(confirmed) || !isValidIsoDate(desired)) continue

    const overrunDays = diffDaysIso(desired, confirmed)
    const daysUntilDeadline = diffDaysIso(todayIso, desired)

    const isPlanOverrun = overrunDays > 0
    const isDeadlineNear = daysUntilDeadline <= bufferDays
    if (!isPlanOverrun && !isDeadlineNear) continue

    rows.push({ order, overrunDays, daysUntilDeadline })
  }

  rows.sort((a, b) => {
    if (b.overrunDays !== a.overrunDays) return b.overrunDays - a.overrunDays
    const da = a.order.desired_deadline?.slice(0, 10) ?? ""
    const db = b.order.desired_deadline?.slice(0, 10) ?? ""
    return da.localeCompare(db)
  })

  return rows
}

export interface DeadlineRiskLabel {
  text: string
  /** `overrun` = 既に超過（強い強調）、`imminent` = 目前（弱い強調） */
  severity: "overrun" | "imminent"
}

/**
 * リスク行の「超過日数」セルの表示文言を決める（Issue #403）。
 * 残日数条件だけで入った行（超過日数 0 以下）は負値を出さず「あと N 日」等に切り替える。
 */
export function describeDeadlineRisk(row: DeadlineRiskOrder): DeadlineRiskLabel {
  if (row.overrunDays > 0) {
    return { text: `${row.overrunDays}日超過`, severity: "overrun" }
  }
  if (row.daysUntilDeadline > 0) {
    return { text: `あと${row.daysUntilDeadline}日`, severity: "imminent" }
  }
  if (row.daysUntilDeadline === 0) {
    return { text: "本日が希望納期", severity: "imminent" }
  }
  return { text: `希望納期が${-row.daysUntilDeadline}日前`, severity: "overrun" }
}
