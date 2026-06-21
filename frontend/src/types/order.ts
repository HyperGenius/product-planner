/**
 * 注文のデータ型
 */
export interface Order {
  id: number
  order_no: string | null
  product_id: number
  customer_id?: number
  quantity: number
  desired_deadline?: string // ISO 8601形式
  confirmed_deadline?: string // ISO 8601形式
  status: 'draft' | 'confirmed' | 'completed' | 'canceled'
  is_scheduled: boolean
  has_unconfirmed_routings?: boolean
  source_type: 'manual' | 'email'
  source_raw?: string
  tenant_id: string
  created_at: string | null
  updated_at: string | null
}

/**
 * 注文作成時のデータ型
 */
export interface OrderCreate {
  order_no?: string
  product_id: number
  customer_id?: number
  quantity: number
  desired_deadline?: string
}

/**
 * 注文シミュレーション要求のデータ型
 */
export interface OrderSimulateRequest {
  product_id: number
  quantity: number
  desired_deadline?: string
  standalone?: boolean
}

/**
 * 工程スケジュール（シミュレーション結果の一部）
 */
export interface ProcessSchedule {
  process_name: string
  start_time: string // ISO 8601形式
  end_time: string // ISO 8601形式
  equipment_name?: string
}

/**
 * 注文シミュレーション結果のデータ型
 */
export interface OrderSimulateResponse {
  calculated_deadline: string // ISO 8601形式
  is_feasible: boolean // 希望納期に間に合うか
  process_schedules: ProcessSchedule[]
}

/**
 * 一括シミュレーション結果の1件分
 */
export interface BulkSimulateResult {
  orderId: number
  orderNo: string
  desiredDeadline?: string // ユーザー希望納期 (ISO 8601形式)
  result: OrderSimulateResponse | null // null = シミュレーション失敗
}
