/**
 * スケジュールのデータ型（バックエンドAPIレスポンス）
 */
export interface Schedule {
  id: number
  order_id: number
  process_routing_id: number
  equipment_id: number
  start_datetime: string // ISO 8601形式
  end_datetime: string // ISO 8601形式
  order_number?: string
  product_name?: string
  process_name?: string
  equipment_name?: string
}

/**
 * ガントチャートの表示モード
 */
export type GanttViewMode = 'Day' | 'Week' | 'Month'
