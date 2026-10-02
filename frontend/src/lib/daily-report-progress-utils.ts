import { format, parseISO } from "date-fns"
import type { ProcessProgress, ProgressStatus } from "@/types/daily-report-progress"

/**
 * 日報の実績による工程の進捗の表示ロジック (Issue #491)。
 * ガントチャート（`components/schedule/gantt-chart.tsx`）と受注詳細の工程一覧で共有する。
 */

/** 受注×工程の進捗を引くキー（スケジュールの `order_id` / `process_routing_id` で引く） */
export function progressKey(orderId: number, processRoutingId: number): string {
  return `${orderId}__${processRoutingId}`
}

export function indexProgress(
  items: readonly ProcessProgress[] | undefined,
): Map<string, ProcessProgress> {
  const map = new Map<string, ProcessProgress>()
  items?.forEach((p) => map.set(progressKey(p.order_id, p.process_routing_id), p))
  return map
}

/**
 * 進捗率（0〜1）。完了は 1。未着手・受注数量が不明なときは null（塗らない＝現状どおりの表示）。
 */
export function progressRatio(progress: ProcessProgress): number | null {
  if (progress.status === "completed") return 1
  if (progress.status === "not_started") return null
  if (!progress.order_quantity || progress.order_quantity <= 0) return null
  return Math.min(progress.good_qty / progress.order_quantity, 1)
}

/**
 * 遅れ: 計画の終了日時を過ぎても完了になっていない（未着手を含む）。
 * 時刻（タイムスタンプ同士）の比較なので端末のタイムゾーンに依存しない（JST 基準の判定と同じ結果になる）。
 */
export function isProgressDelayed(progress: ProcessProgress, now: Date): boolean {
  if (progress.status === "completed" || !progress.planned_end_datetime) return false
  return now.getTime() > new Date(progress.planned_end_datetime).getTime()
}

const STATUS_LABEL: Record<ProgressStatus, string> = {
  not_started: "未着手",
  in_progress: "進行中",
  completed: "完了",
}

export function progressStatusLabel(progress: ProcessProgress): string {
  if (progress.status === "completed" && progress.completed_by === "later_process") {
    return "完了（後工程の実績から推定）"
  }
  return STATUS_LABEL[progress.status]
}

/** 実績数量の表記（例: "80 / 100"）。受注数量が不明なら良品数のみ */
export function formatProgressQuantity(progress: ProcessProgress): string {
  return progress.order_quantity !== null
    ? `${progress.good_qty.toLocaleString()} / ${progress.order_quantity.toLocaleString()}`
    : progress.good_qty.toLocaleString()
}

/** 初回〜最終の実績日（例: "9/10〜9/12"、同日なら "9/10"）。実績が無ければ null */
export function formatActualDateRange(progress: ProcessProgress): string | null {
  const { first_actual_date: first, last_actual_date: last } = progress
  if (!first && !last) return null
  // 日付のみの値は parseISO でローカル深夜として読む（new Date だと UTC 深夜になり日付がずれる）
  const fmt = (value: string) => format(parseISO(value), "M/d")
  if (!first || !last || first === last) return fmt((first ?? last)!)
  return `${fmt(first)}〜${fmt(last)}`
}
