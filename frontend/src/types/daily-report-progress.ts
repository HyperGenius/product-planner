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

/** 未割当の理由（`daily_report_unallocated_actuals.reason`） */
export type UnallocatedReason =
  | "no_routing_process"
  | "no_candidate_order"
  | "before_order_date"
  | "exceeds_order_qty"
  | "no_work_date"

/** GET /daily-reports/unallocated-actuals の1行（明細1行×マスタの工程名） */
export interface UnallocatedActual {
  id: number
  entry_id: number
  product_id: number
  customer_id: number | null
  /** マスタの工程名 */
  process_name: string
  /** 日付のみ（"YYYY-MM-DD"） */
  work_date: string | null
  qty: number
  reason: UnallocatedReason
  /** 日報上の位置と表記 */
  sheet_name: string | null
  row_no: number | null
  customer_raw: string | null
  product_raw: string | null
  process_raw: string | null
}

/**
 * 照合状況の画面での未割当の分類 (Issue #542)。
 * `no_candidate_order` は、その製品の候補にならない受注の有無で
 * `unapproved_order`（下書き・承認待ちあり）/ `closed_order_only`（出荷済み・完了だけ）/ `no_order` に分かれる
 */
export type UnallocatedCategory =
  | "no_routing_process"
  | "unapproved_order"
  | "closed_order_only"
  | "no_order"
  | "before_order_date"
  | "exceeds_order_qty"
  | "no_work_date"

export interface UnallocatedCategoryTotal {
  category: UnallocatedCategory
  row_count: number
  qty: number
}

/**
 * 照合状況のサマリ。数量の単位は「明細×マスタの工程名」（1行が2工程に対応する明細は2回数える）。
 * 未照合は工程が決まらないので1行1回
 */
export interface CoverageSummary {
  total_qty: number
  allocated_qty: number
  unallocated_qty: number
  unmatched_rows: number
  unmatched_qty: number
  /** 分類ごとの未割当（数量の多い順） */
  unallocated: UnallocatedCategoryTotal[]
}

/** 未割当の (製品, 工程名, 理由) ごとのまとめ */
export interface UnallocatedGroup {
  product_id: number
  product_name: string | null
  product_code: string | null
  /** 製品に工程ルートが1件でもあるか */
  product_has_routings: boolean
  /** マスタの工程名（別名辞書で解決した後の名前） */
  process_name: string
  reason: UnallocatedReason
  category: UnallocatedCategory
  row_count: number
  qty: number
  /** 日付のみ（"YYYY-MM-DD"） */
  first_work_date: string | null
  last_work_date: string | null
  customer_names: string[]
}

/** GET /daily-reports/coverage */
export interface DailyReportCoverage {
  /** 割り付けの最終計算日時。一度も計算していなければ null */
  computed_at: string | null
  /** 加工日の絞り込みの開始日（日付のみ）。すべての期間なら null */
  since: string | null
  summary: CoverageSummary
  /** 数量の多い順 */
  groups: UnallocatedGroup[]
}
