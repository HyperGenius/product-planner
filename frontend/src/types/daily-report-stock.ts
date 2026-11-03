/**
 * 日報からの作り置き（先行着手）の推定と、現場の指摘の型 (Issue #591)。
 * Backend の `app/models/daily_report_stock.py` と一致させること。
 */

/**
 * 指摘の種別。
 * `not_stocked`: この製品は作り置きしていない / `stock_process`: 作り置きしているのは指定の工程の後
 */
export type StockFeedbackKind = "not_stocked" | "stock_process"

export interface StockEstimate {
  product_id: number
  product_name: string | null
  product_code: string | null
  /** 作り置きしている工程（この工程の後に置いている） */
  process_name: string
  /** 日報に出てくる次の工程。null は日報に出てくる最後の工程（送品で減る） */
  next_process_name: string | null
  qty: number
  /** 最後に増減した加工日（日付のみ） */
  last_movement_date: string | null
}

export interface StockFeedback {
  product_id: number
  product_name: string | null
  product_code: string | null
  kind: StockFeedbackKind
  process_name: string | null
  /** 基準日（の作業を終えた時点）の作り置きの数 */
  baseline_qty: number | null
  /** 日付のみ（"YYYY-MM-DD"） */
  baseline_date: string | null
  note: string | null
  updated_by: string
  /** タイムスタンプ（ISO 8601） */
  updated_at: string
}

/** GET /daily-reports/stock-estimates */
export interface StockEstimates {
  /** 推定の最終計算日時。一度も計算していなければ null */
  computed_at: string | null
  /** 推定数の多い順 */
  items: StockEstimate[]
  /** 指摘日時の新しい順。推定が出ていない製品の指摘も含む */
  feedback: StockFeedback[]
}

/** PUT /daily-reports/stock-feedback/{product_id} */
export type StockFeedbackInput =
  | { kind: "not_stocked"; note: string | null }
  | {
      kind: "stock_process"
      process_name: string
      baseline_qty: number | null
      baseline_date: string | null
      note: string | null
    }

/** 引き当て元の日報の明細（日報に書かれた表記のまま。Issue #624） */
export interface StockSourceEntry {
  entry_id: number
  /** 日付のみ */
  work_date: string | null
  product_raw: string | null
  customer_raw: string | null
  equipment_raw: string | null
  /** 充てた数（候補では未割当に残っている数） */
  qty: number
}

/** 受注に手で引き当てた作り置き (Issue #624) */
export interface StockAssignment {
  id: string
  order_id: number
  /** 受注の製品の工程ルートにある工程名。この工程まで済んだ作り置きを充てた */
  process_name: string
  qty: number
  /** 引き当てた日（日付のみ）。この日以前の加工日の日報だけを充てる */
  assigned_on: string
  note: string | null
  updated_by: string
  /** タイムスタンプ（ISO 8601） */
  updated_at: string
  /** 前回の集計で充当した日報の明細（加工日の新しい順）。登録後、次の集計までは空 */
  sources: StockSourceEntry[]
}

export interface OrderStockEstimate {
  process_name: string
  next_process_name: string | null
  qty: number
  /** 日付のみ */
  last_movement_date: string | null
}

/** GET /daily-reports/orders/{order_id}/stock-assignments */
export interface OrderStockAssignments {
  /** 割り付けの最終計算日時。引き当ての登録・取り消しはこれより後の計算で反映される */
  computed_at: string | null
  /** 引き当てられる受注か（確定済み・生産中の生産の受注） */
  assignable: boolean
  /** 引き当て先（受注の製品のマスタ上の名前） */
  product_name: string | null
  product_code: string | null
  /** 受注の製品の工程名（工程ルートの順、重複なし） */
  process_names: string[]
  /** 受注の製品の作り置きの推定（この受注への引き当てを差し引いた後） */
  stock_estimates: OrderStockEstimate[]
  assignments: StockAssignment[]
  /** 引き当て元の候補: 受注の製品の未割当の日報の明細（工程名ごと、加工日の新しい順） */
  candidates: Record<string, StockSourceEntry[]>
}

/** PUT /daily-reports/orders/{order_id}/stock-assignments */
export interface StockAssignmentInput {
  process_name: string
  qty: number
  note: string | null
}
