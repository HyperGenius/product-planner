/**
 * 製品のデータ型
 */
export interface Product {
  id: number
  name: string
  code: string
  type: string
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
}
