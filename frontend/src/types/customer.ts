/**
 * 顧客のデータ型
 */
export interface Customer {
  id: number
  name: string
  alias?: string
  representative_name?: string
  phone_number?: string
  /** FAX 番号。注文書の送信元番号での顧客照合に使う（Issue #521） */
  fax_number?: string
  email?: string
  status: "active" | "draft"
  tenant_id: string
  created_at: string
  updated_at: string
}

/**
 * 顧客作成時のデータ型
 */
export interface CustomerCreate {
  name: string
  alias?: string
  representative_name?: string
  phone_number?: string
  fax_number?: string
  email?: string
}

/**
 * 顧客更新時のデータ型
 *
 * PATCH は送ったキーだけを更新するので、任意項目を消すときは `null` を送る
 * （`undefined` は JSON からキーごと落ちて更新されない。Issue #517）
 */
export interface CustomerUpdate {
  name?: string
  alias?: string | null
  representative_name?: string | null
  phone_number?: string | null
  fax_number?: string | null
  email?: string | null
}

/**
 * 顧客の担当者（Issue #611）
 *
 * Gmail 取り込みはこのアドレスで顧客を突合する。`email` は小文字・前後空白なしで保存される
 */
export interface CustomerContact {
  id: string
  customer_id: number
  email: string
  /** 一覧での見分けに使う登録名（任意） */
  contact_name: string | null
  created_at: string
}

export interface CustomerContactCreate {
  email: string
  contact_name?: string | null
}

/**
 * 重複顧客の統合（Issue #610）。
 * Backend `models/master/customer_merge_schemas.py` と一致させる。
 */
export interface CustomerMergeRequest {
  keep_customer_id: number
  merge_customer_ids: number[]
}

export interface CustomerMergeTarget {
  id: number
  name: string
  alias: string | null
  email: string | null
}

export interface CustomerMergeCounts {
  orders_reassigned: number
  attachments_reassigned: number
  /** 製品の別名の付け替え件数 */
  aliases_reassigned: number
  /** 同じ表記が残す顧客にもあるため捨てる製品の別名の件数 */
  aliases_dropped: number
  alias_history_reassigned: number
  customer_aliases_reassigned: number
  unallocated_actuals_reassigned: number
  prompt_history_reassigned: number
  contacts_reassigned: number
  customers_deleted: number
}

export interface CustomerMergeBlocker {
  reason: "order_conflict"
  customer_id: number
  customer_name: string
  order_id: number
  order_number: string | null
  order_status: string
  conflicting_order_id: number
  conflicting_order_number: string | null
}

export interface CustomerMergePreview {
  keep_customer_id: number
  merge_customer_ids: number[]
  merge_customers: CustomerMergeTarget[]
  counts: CustomerMergeCounts
  blockers: CustomerMergeBlocker[]
}

export interface CustomerMergeLogEntry {
  id: number
  keep_customer_id: number | null
  keep_customer_name: string
  merged_customers: CustomerMergeTarget[]
  counts: CustomerMergeCounts
  merged_by: string | null
  merged_at: string
}
