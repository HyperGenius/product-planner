/**
 * 製品のデータ型
 */
export interface Product {
  id: number
  name: string
  /** 図番。ズメーン未突合・未移行テナントの既存データは NULL があり得る */
  code: string | null
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
}

/**
 * 製品更新時のデータ型
 *
 * `code` は `null` を送ると図番をクリア（DB 上 NULL）できる。空文字は送らない
 * （Backend の `ProductUpdateSchema.code: str | None` と整合、`UNIQUE(tenant_id, code)` 対策）。
 */
export interface ProductUpdate {
  name?: string
  code?: string | null
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
  /**
   * 現在も有効な別名の最新履歴行にのみ入る product_name_aliases.id（Issue #351）。
   * 付け替え済み・削除済み・過去行では null。この値がある行にだけ
   * 「付け替え」「削除」アクションを表示する。
   */
  alias_id: string | null
  product_id: number | null
  product_name_snapshot: string
  /** どの顧客の別名か（Issue #349）。顧客削除後は customer_id が null になり、
   *  customer_name_snapshot で内容を追える。 */
  customer_id: number | null
  customer_name_snapshot: string
  raw_text: string
  changed_by: string
  changed_by_full_name: string | null
  action: "created" | "updated" | "deleted"
  /**
   * 別名の由来（Issue #350）。
   * - `manual_correction`: 担当者が明示的に product_id を修正した
   * - `auto_match_unreviewed`: 自動マッチのまま承認依頼された（人間の明示確認なし）
   * - `daily_report`: 日報の商品名を事務担当者が対応付けた（Issue #488）
   */
  source: "manual_correction" | "auto_match_unreviewed" | "daily_report"
  source_order_id: number | null
  source_order_label_snapshot: string
  changed_at: string
}

/**
 * 表記ゆれ辞書エントリの向き先製品を付け替えるリクエスト（Issue #351）
 */
export interface ProductNameAliasUpdate {
  product_id: number
}

/**
 * 重複製品の統合（Issue #515）の候補。
 * Backend `models/master/product_merge_schemas.py` の `ProductMergeCandidate` と一致させる。
 */
export interface ProductMergeCandidate {
  id: number
  name: string
  code: string | null
  is_active: boolean
  /** 品名の先頭の接頭辞（無ければ空文字） */
  prefix: string
  /** 接頭辞の比較用キー。残す製品と違う候補は統合できない */
  prefix_key: string
  routing_count: number
  /** 工程時間が登録された工程数 */
  timed_routing_count: number
  has_decimal_time: boolean
  /** 受注件数（ステータス別） */
  order_counts: Record<string, number>
  alias_count: number
  /** 正しさの順位。3: 工程時間が小数まで / 2: 工程時間あり / 1: 工程のみ / 0: 工程なし */
  rank: number
}

export interface ProductMergeCandidatesResponse {
  diameter: string
  length: string
  material: string
  candidates: ProductMergeCandidate[]
  /** 残す製品の初期選択。正しさの順位が最上位の候補が1件だけのときに入る */
  default_keep_product_id: number | null
}

export interface ProductMergeCandidatesParams {
  diameter: string
  length: string
  material: string
}

export interface ProductMergeRequest {
  keep_product_id: number
  merge_product_ids: number[]
}

export type ProductMergeBlockerReason =
  | "spec_mismatch"
  | "prefix_mismatch"
  | "order_conflict"
  | "routing_mismatch"

export interface ProductMergeBlocker {
  reason: ProductMergeBlockerReason
  product_id: number
  product_name: string
  order_id: number | null
  order_number: string | null
  order_status: string | null
  /** order_conflict の衝突先の受注 */
  conflicting_order_id: number | null
  conflicting_order_number: string | null
  /** routing_mismatch で残す製品に無い工程の順序 */
  sequence_order: number | null
}

export interface ProductMergeCounts {
  orders_reassigned: number
  schedules_reassigned: number
  aliases_reassigned: number
  alias_history_reassigned: number
  orders_deleted: number
  routings_deleted: number
  products_deleted: number
}

export interface ProductMergeOrderRef {
  id: number
  order_number: string | null
  product_id: number
  status: string
}

export interface ProductMergePreview {
  keep_product_id: number
  merge_product_ids: number[]
  counts: ProductMergeCounts
  /** 衝突のため削除される出荷済みの受注 */
  deleted_orders: ProductMergeOrderRef[]
  blockers: ProductMergeBlocker[]
}
