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
