/**
 * 日報の実績による受注の進捗の型 (Issue #490 / #491)。
 * Backend の `app/models/daily_report_progress.py` と一致させること。
 */

export type ProgressStatus = "not_started" | "in_progress" | "completed"

/** completed の根拠（quantity: 良品数が受注数量以上 / later_process: 後の工程に実績がある） */
export type CompletedBy = "quantity" | "later_process"

export interface ProcessProgress {
  order_id: number
  process_routing_id: number
  sequence_order: number | null
  process_name: string | null
  /** 割り付けた良品数（受注数量が上限） */
  good_qty: number
  /** 受注数量（進捗率の分母） */
  order_quantity: number | null
  /** 日付のみ（"YYYY-MM-DD"） */
  first_actual_date: string | null
  last_actual_date: string | null
  status: ProgressStatus
  completed_by: CompletedBy | null
  /** 計画の終了日時（その工程の最後のセグメントの終了。ISO 8601）。未スケジュールなら null */
  planned_end_datetime: string | null
}

/** GET /orders/{order_id}/progress */
export interface OrderProgress {
  order_id: number
  /** テナントの最終計算日時。一度も計算していなければ null */
  computed_at: string | null
  /** 割り付けの対象外（確定済み・生産中以外）の受注は空 */
  processes: ProcessProgress[]
}

/** GET /daily-reports/order-progress */
export interface OrderProgressList {
  computed_at: string | null
  items: ProcessProgress[]
}
