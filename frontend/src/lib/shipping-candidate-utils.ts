import {
  getDaysRemaining,
  getDeadlineStatus,
  getEffectiveDeadline,
  IN_PRODUCTION_STATUSES,
  type DeadlineStatus,
} from "@/lib/floor-dashboard-utils"
import { jstTodayIso } from "@/lib/order-utils"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { Order } from "@/types/order"

/**
 * 「送品の消し込み」画面（Issue #557）の候補判定。送品の記録は弥生が正なので、
 * ここでは送品済みになっていそうな注文を候補として示すだけで、自動では送品済みにしない
 */

/**
 * 候補の理由
 *
 * - `final_process_completed`（A）: 日報の進捗で最終工程（`sequence_order` が最大）が完了
 * - `overdue`（B）: 納期が今日（JST）より前
 * - `due_soon`（C）: 納期まで残り7日未満（現場ダッシュボードの「1週間未満」と同じ閾値）
 */
export type ShippingCandidateReason = "final_process_completed" | "overdue" | "due_soon"

/** 表示順（バッジの並び） */
export const SHIPPING_CANDIDATE_REASONS: readonly ShippingCandidateReason[] = [
  "final_process_completed",
  "overdue",
  "due_soon",
]

/** 送品の消し込みの対象（確定済・生産中） */
export function isShippingTarget(order: Order): boolean {
  return IN_PRODUCTION_STATUSES.includes(order.status)
}

/** 納期の基準: 顧客の納期（`desired`）か、希望納期が無いときの完成見込み（`effective`） */
export type ShippingDeadlineSource = "desired" | "effective"

/**
 * 送品の判定に使う納期。送品は顧客の納期に合わせるので希望納期を優先し、
 * 無ければ完成見込み（確定納期 → シミュ納期）に落とす
 */
export function getShippingDeadline(
  order: Order,
): { date: string; source: ShippingDeadlineSource } | null {
  if (order.desired_deadline) return { date: order.desired_deadline.slice(0, 10), source: "desired" }
  const effective = getEffectiveDeadline(order)
  return effective ? { date: effective.slice(0, 10), source: "effective" } : null
}

/** 受注1件の工程の進捗のまとめ */
export interface OrderProgressSummary {
  completedCount: number
  totalCount: number
  /** 最終工程（`sequence_order` が最大）が完了しているか */
  finalProcessCompleted: boolean
}

/**
 * 受注1件の工程の進捗をまとめる。進捗の行が無い（割り付けが未計算・対象外）なら null（「日報なし」）。
 * `sequence_order` が無い行は最終工程の判定に使わない
 */
export function summarizeOrderProgress(
  processes: readonly ProcessProgress[] | undefined,
): OrderProgressSummary | null {
  if (!processes || processes.length === 0) return null
  let finalProcess: ProcessProgress | null = null
  for (const p of processes) {
    if (p.sequence_order === null) continue
    if (finalProcess === null || p.sequence_order > (finalProcess.sequence_order ?? -Infinity)) {
      finalProcess = p
    }
  }
  return {
    completedCount: processes.filter((p) => p.status === "completed").length,
    totalCount: processes.length,
    finalProcessCompleted: finalProcess?.status === "completed",
  }
}

/** 進捗の行を受注 ID ごとにまとめる */
export function groupProgressByOrder(
  items: readonly ProcessProgress[] | undefined,
): Map<number, ProcessProgress[]> {
  const map = new Map<number, ProcessProgress[]>()
  items?.forEach((p) => {
    const list = map.get(p.order_id)
    if (list) list.push(p)
    else map.set(p.order_id, [p])
  })
  return map
}

/** 「送品の消し込み」の1行 */
export interface ShippingRow {
  order: Order
  deadline: string | null
  deadlineSource: ShippingDeadlineSource | null
  deadlineStatus: DeadlineStatus | null
  /** 納期までの残り日数（今日=0、超過は負）。納期が無ければ null */
  daysRemaining: number | null
  /** 進捗の行が無ければ null（「日報なし」） */
  progress: OrderProgressSummary | null
  /** 候補の理由（`SHIPPING_CANDIDATE_REASONS` の順）。空なら候補でない */
  reasons: ShippingCandidateReason[]
}

/**
 * 注文1件を判定する。進捗が無い注文は A では候補にしない（B・C だけで判定する。
 * Issue #491 の「進捗の行が無い工程は遅れにしない」と同じ考え方）
 *
 * @param todayIso JST の今日（"YYYY-MM-DD"）
 */
export function buildShippingRow(
  order: Order,
  processes: readonly ProcessProgress[] | undefined,
  todayIso: string,
): ShippingRow {
  const deadline = getShippingDeadline(order)
  const deadlineStatus = getDeadlineStatus(deadline?.date, todayIso)
  const progress = summarizeOrderProgress(processes)
  const reasons: ShippingCandidateReason[] = []
  if (progress?.finalProcessCompleted) reasons.push("final_process_completed")
  if (deadlineStatus === "overdue") reasons.push("overdue")
  if (deadlineStatus === "due_soon") reasons.push("due_soon")
  return {
    order,
    deadline: deadline?.date ?? null,
    deadlineSource: deadline?.source ?? null,
    deadlineStatus,
    daysRemaining: deadline ? getDaysRemaining(deadline.date, todayIso) : null,
    progress,
    reasons,
  }
}

/**
 * 並び: 最終工程が完了していて納期超過のもの（A かつ B）を先頭に、次に納期の古い順。
 * 納期が無い注文は末尾、同じ納期なら注文 ID の昇順
 */
export function compareShippingRows(a: ShippingRow, b: ShippingRow): number {
  const aTop = a.reasons.includes("final_process_completed") && a.reasons.includes("overdue")
  const bTop = b.reasons.includes("final_process_completed") && b.reasons.includes("overdue")
  if (aTop !== bTop) return aTop ? -1 : 1
  if (a.deadline !== b.deadline) {
    if (a.deadline === null) return 1
    if (b.deadline === null) return -1
    return a.deadline < b.deadline ? -1 : 1
  }
  return a.order.id - b.order.id
}

/**
 * 対象（確定済・生産中）の注文を判定して並べる
 *
 * @param progressItems `GET /daily-reports/order-progress` の行
 * @param todayIso JST の今日（"YYYY-MM-DD"）。省略時は現在時刻から求める
 */
export function buildShippingRows(
  orders: readonly Order[],
  progressItems: readonly ProcessProgress[] | undefined,
  todayIso: string = jstTodayIso(),
): ShippingRow[] {
  const progressByOrder = groupProgressByOrder(progressItems)
  return orders
    .filter(isShippingTarget)
    .map((order) => buildShippingRow(order, progressByOrder.get(order.id), todayIso))
    .sort(compareShippingRows)
}

/** 候補（理由が1つ以上ある行）か */
export function isShippingCandidate(row: ShippingRow): boolean {
  return row.reasons.length > 0
}
