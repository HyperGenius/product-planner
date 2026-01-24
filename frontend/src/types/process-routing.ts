/**
 * 製造工程ルーティングのデータ型
 */
export interface ProcessRouting {
  id: number
  product_id: number
  process_name: string
  equipment_group_id: number
  sequence_order: number
  setup_time_seconds: number
  unit_time_seconds: number
  tenant_id: string
  created_at: string
  updated_at: string
}

/**
 * 製造工程ルーティング作成時のデータ型
 */
export interface ProcessRoutingCreate {
  product_id: number
  process_name: string
  equipment_group_id: number
  sequence_order: number
  setup_time_seconds: number
  unit_time_seconds: number
}

/**
 * 製造工程ルーティング更新時のデータ型
 */
export interface ProcessRoutingUpdate {
  process_name?: string
  equipment_group_id?: number
  sequence_order?: number
  setup_time_seconds?: number
  unit_time_seconds?: number
}
