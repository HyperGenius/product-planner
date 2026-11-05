import { formatDistanceStrict } from "date-fns"
import { ja } from "date-fns/locale"
import { getDaysRemaining } from "@/lib/floor-dashboard-utils"
import { jstTodayIso } from "@/lib/order-utils"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { OpenDeliveryRequestListItem } from "@/types/order-delivery-request"

/**
 * 督促・分納の依頼一覧（Issue #635）の表示ロジック。
 * 納期の基準は画面ごとに違う（現場ダッシュボードは完成見込み、送品の消し込みは希望納期）ので、
 * この画面では希望納期と完成見込みを併記し、基準を混ぜない。
 */

/** 希望納期を過ぎた日数（JST の今日基準）。納期前・納期なしは null */
export function overdueDays(
  desiredDeadline: string | null,
  todayIso: string = jstTodayIso(),
): number | null {
  if (!desiredDeadline) return null
  const days = -getDaysRemaining(desiredDeadline, todayIso)
  return days > 0 ? days : null
}

/** 完成見込み。承認後の確定値（`confirmed_deadline`）を優先し、無ければシミュレーションの値 */
export function expectedCompletion(
  request: Pick<OpenDeliveryRequestListItem, "confirmed_deadline" | "simulated_deadline">,
): string | null {
  return request.confirmed_deadline ?? request.simulated_deadline
}

/**
 * 受注の最終工程（`sequence_order` 最大）の進捗。進捗の行が無い受注は undefined
 * （割り付け対象外・未計算。遅れとも未着手とも見せない）
 */
export function finalProcessProgress(
  processes: readonly ProcessProgress[] | undefined,
): ProcessProgress | undefined {
  if (!processes || processes.length === 0) return undefined
  return processes.reduce((latest, p) =>
    (p.sequence_order ?? -1) >= (latest.sequence_order ?? -1) ? p : latest,
  )
}

/** 受信からの経過（例: "3日"）。タイムスタンプなので `new Date()` で読む */
export function elapsedSince(createdAt: string, now: Date = new Date()): string {
  return formatDistanceStrict(new Date(createdAt), now, { locale: ja })
}

export type DeliveryRequestSort = "received" | "overdue"

/** 並べ替え。`received` は API の順（受信の新しい順）のまま。`overdue` は超過日数の大きい順（無いものは後ろ） */
export function sortDeliveryRequests(
  requests: readonly OpenDeliveryRequestListItem[],
  sort: DeliveryRequestSort,
  todayIso: string = jstTodayIso(),
): OpenDeliveryRequestListItem[] {
  if (sort === "received") return [...requests]
  return requests
    .map((request, index) => ({
      request,
      index,
      days: overdueDays(request.desired_deadline, todayIso) ?? 0,
    }))
    .sort((a, b) => b.days - a.days || a.index - b.index)
    .map((x) => x.request)
}
