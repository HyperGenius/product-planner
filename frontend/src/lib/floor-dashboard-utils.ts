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

/** "YYYY-MM-DD" に日数を加算した "YYYY-MM-DD" を返す（ローカルTZに依存しない日付計算） */
function addDaysToIsoDate(iso: string, days: number): string {
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
