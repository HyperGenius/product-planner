import type { Order } from "@/types/order"

/**
 * 現場ダッシュボードで「受注中」とみなす受注ステータス（Issue #441）。
 * `use-dashboard-metrics.ts` の `IN_PRODUCTION_STATUSES` と同じ定義。
 */
export const IN_PRODUCTION_STATUSES: readonly Order["status"][] = ["confirmed", "in_progress"]

/** 承認確定後は confirmed_deadline、承認前は simulated_deadline を納期とみなす（CLAUDE.md 納期フィールドの方針に準拠） */
export function getEffectiveDeadline(order: Order): string | undefined {
  return order.confirmed_deadline ?? order.simulated_deadline
}

/**
 * 納期の状態。現場ダッシュボードの顧客別受注情報（#442）と検索・フィルタの凡例（#444）で
 * 閾値がズレないよう共通の純粋関数として切り出す。
 */
export type DeadlineStatus = "overdue" | "due_soon" | "on_track"

/** 「1週間未満」の閾値（日数）。この日数未満（0日＝当日含む）は due_soon */
export const DEADLINE_DUE_SOON_THRESHOLD_DAYS = 7

/** 出荷予定表（Issue #443）の取得期間（本日から何日後まで表示するか） */
export const SHIPMENT_SCHEDULE_WINDOW_DAYS = 13

/**
 * 納期（"YYYY-MM-DD"）と本日（JST基準、"YYYY-MM-DD"）から納期状態を判定する。
 * 日付のみの文字列同士のためISO 8601の辞書順比較（＝時系列順）で判定でき、
 * TZ変換を挟まない（CLAUDE.md 日付文字列パースの方針）。
 * 納期未設定なら null（バッジを出さない）。
 */
export function getDeadlineStatus(
  deadline: string | undefined,
  todayIso: string,
): DeadlineStatus | null {
  if (!deadline) return null
  if (deadline < todayIso) return "overdue"

  const dueSoonBoundary = addDaysToIsoDate(todayIso, DEADLINE_DUE_SOON_THRESHOLD_DAYS)
  if (deadline < dueSoonBoundary) return "due_soon"

  return "on_track"
}

/**
 * "YYYY-MM-DD" に日数を加算した "YYYY-MM-DD" を返す（ローカルTZに依存しない日付計算）。
 * 出荷予定表（Issue #443）の取得期間（本日〜N日後）の算出にも使う
 */
export function addDaysToIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

/**
 * 納期までの残り日数（本日=0、超過は負の値）。バッジの「残りN日」表示用。
 * `getDeadlineStatus` と同様、UTC固定の日付計算でローカルTZの影響を受けないようにする。
 */
export function getDaysRemaining(deadline: string, todayIso: string): number {
  const toUtcDays = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number)
    return Date.UTC(y, m - 1, d) / (24 * 60 * 60 * 1000)
  }
  return toUtcDays(deadline) - toUtcDays(todayIso)
}

/**
 * 納期状態ごとの色クラス。検索・フィルタの凡例（`SearchAndFilterBar`）と納期バッジ
 * （`PlanValueBadges` の `DeadlineValueBadge`）で共有し、色がズレないようにする（Issue #452）。
 */
export const STATUS_CLASS: Record<DeadlineStatus, string> = {
  overdue: "bg-red-600 text-white hover:bg-red-600",
  due_soon: "bg-amber-500 text-white hover:bg-amber-500",
  on_track: "bg-secondary text-secondary-foreground hover:bg-secondary",
}

/** 検索・フィルタ（Issue #444）の状態。顧客別受注情報（#442）・出荷予定表（#443）の両エリアで共有する */
export interface OrderSearchFilters {
  /** 顧客名・製品名・注文番号のいずれかへの部分一致 */
  searchText: string
  /** true の場合、納期超過の注文のみに絞り込む */
  overdueOnly: boolean
}

/** 検索・フィルタ（Issue #444）で顧客名・製品名・注文番号の部分一致に使うフィールド */
export interface SearchableOrderFields {
  customerName: string | null
  productPrimary: string | null
  productSecondary: string | null
  orderNumber: string | null
}

/**
 * 検索語がいずれかのフィールドに部分一致するか判定する（大小文字を区別しない）。
 * 顧客別受注情報（#442）・出荷予定表（#443）の両エリアで共有し、閾値・判定ロジックがズレないようにする。
 * 検索語が空（前後空白のみ含む）なら常に true。
 */
export function matchesSearchText(searchText: string, fields: SearchableOrderFields): boolean {
  const normalized = searchText.trim().toLowerCase()
  if (!normalized) return true

  return [fields.customerName, fields.productPrimary, fields.productSecondary, fields.orderNumber].some(
    (field) => field?.toLowerCase().includes(normalized) ?? false,
  )
}

/**
 * 現場ダッシュボード向けの納期表示（Issue #450）。当年（JST基準）は "MM/DD"、翌年以降は
 * "YYYY/MM/DD"。`order-utils.ts` の `formatDeadlineShort`（他画面向け・2桁年）とは表示桁数が
 * 異なるため、現場ダッシュボード専用の関数として別に持つ。
 * `getDeadlineStatus` 等と同様、`todayIso`（JST基準の "YYYY-MM-DD"）を呼び出し側から受け取る。
 */
export function formatDeadlineForFloorDashboard(
  deadline: string | undefined,
  todayIso: string,
): string | null {
  if (!deadline) return null
  const iso = deadline.slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso.replace(/-/g, "/")
  const [, year, month, day] = m
  const currentYear = todayIso.slice(0, 4)
  return year === currentYear ? `${month}/${day}` : `${year}/${month}/${day}`
}

/**
 * タイムスタンプ（timestamptz の ISO 8601 文字列）を Asia/Tokyo 基準の "YYYY-MM-DD" に変換する。
 * `production_schedules.end_datetime` のような時刻・TZ付きフィールドは `jstTodayIso()` と同じ
 * `en-CA` ロケール変換で JST の暦日に正しく丸められる（CLAUDE.md 日付文字列パースの方針）。
 */
export function toJstDateIso(datetimeIso: string): string {
  return new Date(datetimeIso).toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
}
