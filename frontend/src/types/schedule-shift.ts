/**
 * 工程の前倒し・後ろ倒し（Issue #582）。
 * Backend `models/transaction/schedule_shift.py` の `ProcessShiftResponse` と揃える
 */

export interface ShiftTimeRange {
  start_datetime: string // ISO 8601形式
  end_datetime: string // ISO 8601形式
}

export interface ShiftSegment extends ShiftTimeRange {
  equipment_id: number | null
}

/** 動く工程1つ分（対象＋同じ注文の後工程） */
export interface ShiftedProcess {
  process_routing_id: number
  process_name: string | null
  sequence_order: number | null
  is_milestone: boolean
  /** 日報の進捗で完了済み（動かせるが警告する） */
  is_completed: boolean
  before: ShiftTimeRange
  after: ShiftTimeRange
  segments: ShiftSegment[]
}

/** ずらした後の工程と同じ設備で時間が重なる、他の注文のセグメント（保存は妨げない） */
export interface ShiftOverlap extends ShiftTimeRange {
  process_routing_id: number
  process_name: string | null
  equipment_id: number
  equipment_name: string | null
  other_order_id: number
  other_order_number: string | null
  other_process_name: string | null
}

export interface ProcessShiftResult {
  order_id: number
  process_routing_id: number
  working_days: number
  /** 前倒しが前工程の終了で止まった */
  stopped_at_previous: boolean
  /** 工程順 */
  processes: ShiftedProcess[]
  /** 日付のみ（YYYY-MM-DD。parseISO でパースする） */
  confirmed_deadline_before: string | null
  confirmed_deadline_after: string
  desired_deadline: string | null
  exceeds_desired_deadline: boolean
  overlaps: ShiftOverlap[]
  saved: boolean
}

/** ずらす対象と量（稼働日。負は前倒し） */
export interface ProcessShiftTarget {
  orderId: number
  processRoutingId: number
  workingDays: number
}
