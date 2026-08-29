/**
 * 製品のデータ型
 */
export interface Product {
  id: number
  name: string
  code: string
  type: string
  is_active: boolean
  has_process: boolean
  has_unconfirmed_process: boolean
  tenant_id: string
  created_at: string
  updated_at: string
}

/**
 * 製品作成時のデータ型
 */
export interface ProductCreate {
  name: string
  code: string
  type: string
}

/**
 * 製品更新時のデータ型
 */
export interface ProductUpdate {
  name?: string
  code?: string
  type?: string
  is_active?: boolean
}

/**
 * 製品名の表記ゆれ修正履歴（Issue #347）
 *
 * product_name_alias_history の生データではなく、登録者の表示名・
 * トリガーとなった注文情報を解決した集約レスポンス。
 */
export interface ProductNameAliasHistoryEntry {
  id: string
  product_id: number | null
  product_name_snapshot: string
  /** どの顧客の別名か（Issue #349）。顧客削除後は customer_id が null になり、
   *  customer_name_snapshot で内容を追える。 */
  customer_id: number | null
  customer_name_snapshot: string
  raw_text: string
  changed_by: string
  changed_by_full_name: string | null
  action: "created" | "updated"
  source_order_id: number | null
  source_order_label_snapshot: string
  changed_at: string
}
