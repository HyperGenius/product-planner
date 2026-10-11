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
