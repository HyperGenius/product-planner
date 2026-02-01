/**
 * 顧客のデータ型
 */
export interface Customer {
  id: number
  name: string
  alias?: string
  representative_name?: string
  phone_number?: string
  email?: string
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
  email?: string
}

/**
 * 顧客更新時のデータ型
 */
export interface CustomerUpdate {
  name?: string
  alias?: string
  representative_name?: string
  phone_number?: string
  email?: string
}
