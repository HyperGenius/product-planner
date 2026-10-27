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

/**
 * ガントに出す工程の状態 (Issue #580)。
 * 進捗の行が無い工程（割り付けの対象外の受注・未計算のテナント）は未着手と見せず `planned_only` にする
 */
export type ProcessDisplayState = "planned_only" | "not_started" | "in_progress" | "completed" | "delayed"

export function processDisplayState(
  progress: ProcessProgress | undefined,
  now: Date,
): ProcessDisplayState {
  if (!progress) return "planned_only"
  if (progress.status === "completed") return "completed"
  if (isProgressDelayed(progress, now)) return "delayed"
  return progress.status === "in_progress" ? "in_progress" : "not_started"
}

export const PROCESS_DISPLAY_STATE_LABEL: Record<ProcessDisplayState, string> = {
  planned_only: "計画のみ",
  not_started: "未着手",
  in_progress: "進行中",
  completed: "完了",
  delayed: "遅れ",
}

/** バー内の短い記号・文言（未着手・計画のみは無し）。進行中は進捗率が分かれば `60%` */
export function processStateBadge(
  state: ProcessDisplayState,
  progress: ProcessProgress | undefined,
): string | null {
  switch (state) {
    case "completed":
      return "✓"
    case "delayed":
      return "！"
    case "in_progress": {
      const ratio = progress ? progressRatio(progress) : null
      return ratio !== null ? `${Math.round(ratio * 100)}%` : null
    }
    case "planned_only":
    case "not_started":
      return null
  }
}

/** ラベル列の工程行のバッジ文言（`完了` / `進行中 60%` / `遅れ` / `未着手`）。計画のみは無し */
export function processStateLabelText(
  state: ProcessDisplayState,
  progress: ProcessProgress | undefined,
): string | null {
  if (state === "planned_only") return null
  if (state === "in_progress") {
    const pct = processStateBadge(state, progress)
    return pct ? `進行中 ${pct}` : "進行中"
  }
  return PROCESS_DISPLAY_STATE_LABEL[state]
}

/**
 * 注文全体の状態（注文行のバッジ）。全工程完了 → `完了`、遅れの工程がある → `遅れあり`、
 * それ以外は最終工程（`sequence_order` 最大）の状態。進捗の行が無い注文は null
 */
export function orderStateLabelText(
  processes: readonly ProcessProgress[],
  now: Date,
): { state: ProcessDisplayState | "delayed_some"; text: string } | null {
  if (processes.length === 0) return null
  if (processes.every((p) => p.status === "completed")) return { state: "completed", text: "完了" }
  if (processes.some((p) => isProgressDelayed(p, now))) return { state: "delayed_some", text: "遅れあり" }
  const final = processes.reduce((latest, p) =>
    (p.sequence_order ?? -1) >= (latest.sequence_order ?? -1) ? p : latest,
  )
  const state = processDisplayState(final, now)
  const text = processStateLabelText(state, final)
  return text ? { state, text } : null
}
