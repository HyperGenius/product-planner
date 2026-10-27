import { format, isSameDay } from "date-fns"
import { ja } from "date-fns/locale"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { Schedule } from "@/types/schedule"
import { indexProgress, progressKey, processDisplayState } from "@/lib/daily-report-progress-utils"
import type { ProcessDisplayState } from "@/lib/daily-report-progress-utils"

/**
 * 生産スケジュールの詳細シートの中身 (Issue #581)。ガントで選んだ工程・注文について、
 * 表示中のスケジュールと日報の進捗から組み立てる（シートを開くための API は増やさない）
 */

/** ガントで選んでいるもの。行・バーのタップで決まり、自動更新で取り直しても同じものを指す */
export type ScheduleSelection =
  | { kind: "order"; orderId: number }
  | { kind: "process"; orderId: number; processRoutingId: number }

export interface TimeRange {
  start: Date
  end: Date
}

/** 工程の詳細 */
export interface ProcessDetail {
  kind: "process"
  /** 注文の項目を読むためのスケジュール（その工程の表示中の最初のセグメント） */
  head: Schedule
  processRoutingId: number
  processName: string
  sequenceOrder: number | null
  /** 設備（グループ）の表示名。セグメントごとに違いうるので重複を除いて並べる */
  equipmentGroupNames: string[]
  /** 表示中のセグメント（開始順） */
  segments: Schedule[]
  /** 表示中のセグメントの範囲 */
  visibleRange: TimeRange
  /** 工程全体の範囲（表示期間外を含む。API の process_start/end_datetime） */
  processRange: TimeRange
  progress: ProcessProgress | undefined
  state: ProcessDisplayState
}

/** 注文の詳細に並べる工程1つ分 */
export interface OrderProcessSummary {
  processRoutingId: number
  processName: string
  sequenceOrder: number | null
  equipmentGroupName: string | null
  /** 表示中のセグメントの範囲。表示期間に無い工程（進捗の行だけある）は null */
  visibleRange: TimeRange | null
  segmentCount: number
  progress: ProcessProgress | undefined
  state: ProcessDisplayState
}

/** 注文の詳細 */
export interface OrderDetail {
  kind: "order"
  head: Schedule
  /** 注文全体の範囲（表示期間外を含む。API の order_start/end_datetime） */
  orderRange: TimeRange
  /** 工程順（sequence_order → 表示中の開始） */
  processes: OrderProcessSummary[]
  /** 注文の全工程の進捗（注文の状態の判定用） */
  progressItems: ProcessProgress[]
}

export type ScheduleDetail = ProcessDetail | OrderDetail

const toTime = (iso: string) => new Date(iso).getTime()
const byStart = (a: Schedule, b: Schedule) => toTime(a.start_datetime) - toTime(b.start_datetime)

function rangeOf(segments: Schedule[]): TimeRange {
  return {
    start: new Date(Math.min(...segments.map((s) => toTime(s.start_datetime)))),
    end: new Date(Math.max(...segments.map((s) => toTime(s.end_datetime)))),
  }
}

function unique(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)))
}

export function buildProcessDetail(
  schedules: readonly Schedule[],
  progressItems: readonly ProcessProgress[] | undefined,
  orderId: number,
  processRoutingId: number,
  now: Date,
): ProcessDetail | null {
  const segments = schedules
    .filter((s) => s.order_id === orderId && s.process_routing_id === processRoutingId)
    .sort(byStart)
  if (segments.length === 0) return null
  const head = segments[0]
  const visibleRange = rangeOf(segments)
  const progress = indexProgress(progressItems).get(progressKey(orderId, processRoutingId))
  return {
    kind: "process",
    head,
    processRoutingId,
    processName: head.process_name || "工程",
    sequenceOrder: head.sequence_order ?? null,
    equipmentGroupNames: unique(segments.map((s) => s.equipment_group_name)),
    segments,
    visibleRange,
    processRange: {
      start: head.process_start_datetime ? new Date(head.process_start_datetime) : visibleRange.start,
      end: head.process_end_datetime ? new Date(head.process_end_datetime) : visibleRange.end,
    },
    progress,
    state: processDisplayState(progress, now),
  }
}

/**
 * 注文の詳細。工程は表示中のスケジュールにある工程と、進捗の行がある工程（確定済み・生産中の注文は全工程）を合わせる。
 * 表示期間に1つもセグメントが無い注文は null（注文の項目を読めない）
 */
export function buildOrderDetail(
  schedules: readonly Schedule[],
  progressItems: readonly ProcessProgress[] | undefined,
  orderId: number,
  now: Date,
): OrderDetail | null {
  const own = schedules.filter((s) => s.order_id === orderId).sort(byStart)
  if (own.length === 0) return null
  const head = own[0]
  const orderProgress = (progressItems ?? []).filter((p) => p.order_id === orderId)
  const progressByRouting = new Map(orderProgress.map((p) => [p.process_routing_id, p]))

  const segmentsByRouting = new Map<number, Schedule[]>()
  own.forEach((s) => {
    segmentsByRouting.set(s.process_routing_id, [...(segmentsByRouting.get(s.process_routing_id) ?? []), s])
  })
  const routingIds = new Set([...segmentsByRouting.keys(), ...progressByRouting.keys()])

  const processes: OrderProcessSummary[] = Array.from(routingIds).map((routingId) => {
    const segments = segmentsByRouting.get(routingId) ?? []
    const progress = progressByRouting.get(routingId)
    const first = segments[0]
    return {
      processRoutingId: routingId,
      processName: first?.process_name || progress?.process_name || "工程",
      sequenceOrder: first?.sequence_order ?? progress?.sequence_order ?? null,
      equipmentGroupName: unique(segments.map((s) => s.equipment_group_name)).join("、") || null,
      visibleRange: segments.length > 0 ? rangeOf(segments) : null,
      segmentCount: segments.length,
      progress,
      state: processDisplayState(progress, now),
    }
  })
  processes.sort((a, b) => {
    const seq = (a.sequenceOrder ?? Number.MAX_SAFE_INTEGER) - (b.sequenceOrder ?? Number.MAX_SAFE_INTEGER)
    if (seq !== 0) return seq
    return (a.visibleRange?.start.getTime() ?? Infinity) - (b.visibleRange?.start.getTime() ?? Infinity)
  })

  const visible = rangeOf(own)
  return {
    kind: "order",
    head,
    orderRange: {
      start: head.order_start_datetime ? new Date(head.order_start_datetime) : visible.start,
      end: head.order_end_datetime ? new Date(head.order_end_datetime) : visible.end,
    },
    processes,
    progressItems: orderProgress,
  }
}

export function buildScheduleDetail(
  selection: ScheduleSelection | null,
  schedules: readonly Schedule[] | undefined,
  progressItems: readonly ProcessProgress[] | undefined,
  now: Date,
): ScheduleDetail | null {
  if (!selection || !schedules) return null
  return selection.kind === "order"
    ? buildOrderDetail(schedules, progressItems, selection.orderId, now)
    : buildProcessDetail(schedules, progressItems, selection.orderId, selection.processRoutingId, now)
}

export function formatDateTime(d: Date): string {
  return format(d, "M/d HH:mm", { locale: ja })
}

/** 期間を日付付きで出す（同じ日なら終了は時刻だけ）。週次で複数日にわたる範囲を1日分に見せないため */
export function formatRange(start: Date, end: Date): string {
  const endLabel = isSameDay(start, end) ? format(end, "HH:mm", { locale: ja }) : formatDateTime(end)
  return `${formatDateTime(start)} - ${endLabel}`
}
