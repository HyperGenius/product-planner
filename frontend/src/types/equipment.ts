/**
 * 設備のデータ型
 */
export interface Equipment {
  id: number
  name: string
  tenant_id: string
  created_at: string
  updated_at: string
}

/**
 * 設備作成時のデータ型
 */
export interface EquipmentCreate {
  name: string
}

/**
 * 設備更新時のデータ型
 */
export interface EquipmentUpdate {
  name: string
}
