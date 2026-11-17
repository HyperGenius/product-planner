/**
 * 弥生の売上明細の名寄せ・送品の突合（Issue #667）。Backend の `app/models/shipment.py` と揃える
 */

/** 受注に当てた決め手 */
export type ShipmentOrderMatchMethod = "order_no" | "deadline" | "single_open_order"

/** 受注に当たった（または候補になった）弥生の明細1行。金額系の列は持たない */
export interface ShipmentEntryRef {
  id: number
  sales_date: string
  slip_no: string | null
  quantity: number | null
  note: string | null
  product_name: string | null
  /** 確定できなかった明細は null */
  method: ShipmentOrderMatchMethod | null
  /** 複数の受注に当たって確定できなかったときの候補 */
  candidate_order_ids: number[]
}

/** 受注1件の弥生の送品（分納・赤伝を合算） */
export interface ShipmentOrderMatch {
  order_id: number
  shipped_qty: number
  order_quantity: number | null
  /** 合算した数量が受注数量に達したか */
  is_fully_shipped: boolean
  last_sales_date: string | null
  entries: ShipmentEntryRef[]
  ambiguous_entries: ShipmentEntryRef[]
}

export interface ShipmentOrderMatchList {
  /** 取り込んだ明細の最新の売上日 */
  latest_sales_date: string | null
  items: ShipmentOrderMatch[]
}

export interface ShipmentCustomerItem {
  /** 弥生の得意先コード（表示用。最新の明細の値） */
  customer_code: string
  /** 照合用に正規化したキー（辞書・対象外の登録はこの値でもよい） */
  code_key: string
  customer_name: string | null
  entry_count: number
  last_sales_date: string
  /** 辞書でひも付けた顧客（商流のため複数ありうる） */
  links: { id: string; customer_id: number }[]
  /** 辞書が無いとき、得意先名の一致で決まった顧客 */
  auto_customer_id: number | null
  ignored_id: string | null
  /** 得意先名の一部が一致する顧客（候補の表示専用） */
  name_candidate_ids: number[]
  /** 商流の推定: 製品が決まらない行の品名が、この顧客の受注の製品に当たった件数 */
  flow_candidates: { customer_id: number; entry_count: number }[]
  unmatched_entry_count: number
}

export type ShipmentProductAutoMethod = "drawing_no" | "spec"

export interface ShipmentProductItem {
  customer_code: string
  customer_code_key: string
  customer_name: string | null
  product_code: string
  product_code_key: string
  product_name: string | null
  entry_count: number
  last_sales_date: string
  /** 得意先に対応する顧客（辞書または得意先名の一致） */
  customer_ids: number[]
  link: { id: string; product_id: number } | null
  auto_product_id: number | null
  auto_method: ShipmentProductAutoMethod | null
  ignored_id: string | null
  /** 得意先を対象外にしたので、この商品も突合しない */
  customer_ignored: boolean
  /** 一意に決まらなかったときの候補（得意先の顧客の受注にある製品） */
  candidate_product_ids: number[]
  /** 商流の推定: 別の顧客の受注に出ている製品 */
  cross_customer_candidates: { product_id: number; customer_ids: number[] }[]
}

/** 受注に当たらない明細の原因（突合の状態。Issue #682） */
export type ShipmentUnmatchedStatus =
  "unmatched_customer" | "unmatched_product" | "no_order" | "ambiguous"

/** 受注に当たらない弥生の明細を (得意先, 商品コード, 原因) でまとめた行。表記は最新の明細の値 */
export interface ShipmentUnmatchedGroup {
  status: ShipmentUnmatchedStatus
  customer_code: string
  customer_code_key: string
  customer_name: string | null
  product_code: string
  product_code_key: string
  product_name: string | null
  latest_note: string | null
  entry_count: number
  /** 明細の数量の合計（赤伝を差し引く） */
  total_qty: number
  last_sales_date: string | null
  /** 照合できた顧客（商流で複数ありうる） */
  customer_ids: number[]
  /** 照合できた製品 */
  product_ids: number[]
  /** 備考の「○/○納期分」の日付 */
  note_deadlines: string[]
  /** 受注が区別できないときの候補 */
  candidate_order_ids: number[]
}

export interface ShipmentUnmatchedList {
  /** 取り込んだ明細の最新の売上日 */
  latest_sales_date: string | null
  /** 対象の期間の始まり（売上日） */
  since: string | null
  /** 原因ごとのまとめの件数（上限で切る前） */
  counts: Record<ShipmentUnmatchedStatus, number>
  /** 原因ごとの上限で切ったまとめがあるか */
  truncated: boolean
  items: ShipmentUnmatchedGroup[]
}

/** 辞書・対象外を書き込めるロール。Backend の SHIPMENT_NAME_EDITOR_ROLES と揃える */
export const SHIPMENT_NAME_EDITOR_ROLES = ["president", "order_handler", "platform_admin"] as const

/**
 * 弥生で送品済みなのに日報の進捗が追いついていない受注の原因（Issue #683）。判定の順に並べる
 *
 * - `no_routing`: 製品に工程が無い
 * - `process_mismatch`: 日報の工程名が工程ルートと合わない（未割当 `no_routing_process`）
 * - `customer_or_stock`: 日報の顧客先が違う・作り置き（未割当 `no_candidate_order` / `before_order_date`）
 * - `missing_report`: どれにも当たらない（日報の書き漏れ・取り込み漏れ。名寄せの未照合も含む）
 */
export type ShipmentOrderReviewCause =
  "no_routing" | "process_mismatch" | "customer_or_stock" | "missing_report"

/** 弥生の送品数量が日報で追う最後の工程の良品数を超えている受注（未送品の確定済・生産中） */
export interface ShipmentOrderReview {
  order_id: number
  product_id: number
  cause: ShipmentOrderReviewCause
  /** 弥生の送品数量（突合で確定した明細の合計） */
  shipped_qty: number
  last_sales_date: string | null
  /** 日報で追う最後の工程。工程が無ければ null */
  final_process_name: string | null
  /** 日報で追う最後の工程の良品数（進捗の行が無ければ0） */
  final_good_qty: number
  /** 原因に当たった未割当の実績の数量の合計 */
  unallocated_qty: number
  /** 原因に当たった未割当の日報の工程名 */
  process_names: string[]
}

export interface ShipmentOrderReviewList {
  /** 日報の割り付けを最後に計算した日時 */
  computed_at: string | null
  counts: Record<ShipmentOrderReviewCause, number>
  items: ShipmentOrderReview[]
}
