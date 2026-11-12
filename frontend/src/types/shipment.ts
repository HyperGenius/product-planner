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

/** 辞書・対象外を書き込めるロール。Backend の SHIPMENT_NAME_EDITOR_ROLES と揃える */
export const SHIPMENT_NAME_EDITOR_ROLES = ["president", "order_handler", "platform_admin"] as const
