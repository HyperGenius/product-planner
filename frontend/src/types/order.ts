/**
 * 注文のデータ型
 */
export interface Order {
  id: number
  order_no: string | null
  product_id: number | null
  extracted_product_name?: string | null
  customer_id?: number
  quantity: number
  desired_deadline?: string // 日付のみ (YYYY-MM-DD)、時刻情報は持たない
  confirmed_deadline?: string // 日付のみ (YYYY-MM-DD)、時刻情報は持たない
  status: 'draft' | 'pending_approval' | 'confirmed' | 'shipped' | 'completed' | 'canceled'
  rejection_reason?: string | null
  customer_certainty: 'confirmed' | 'forecast' | 'forecast_tentative' | null
  is_scheduled: boolean
  has_no_routings?: boolean
  has_unconfirmed_routings?: boolean
  source_type: 'manual' | 'email'
  source_raw?: string
  source_attachment_id?: string | null
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
 * 手動メール起票（Issue #358）の1明細
 * 顧客・本文・添付は全明細で共有し、明細ごとに品番・数量・納期を持つ（分納対応）
 */
export interface ManualEmailIntakeLineItem {
  product_id?: number
  quantity: number
  desired_deadline?: string
  extracted_product_name?: string
}

/**
 * 手動メール起票リクエスト（multipart の payload フィールドに JSON で渡す）
 */
export interface ManualEmailIntakeRequest {
  order_no?: string
  customer_id?: number
  customer_certainty?: 'confirmed' | 'forecast' | 'forecast_tentative'
  source_raw?: string
  line_items: ManualEmailIntakeLineItem[]
}

/**
 * 手動メール起票のレスポンス
 */
export interface ManualEmailIntakeResponse {
  staging_attachment_id: string
  created_orders: Order[]
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
 * routing_status が "no_routing" の場合、calculated_deadline / is_feasible は null
 */
export interface OrderSimulateResponse {
  routing_status?: "no_routing" | "unconfirmed"
  calculated_deadline: string | null // ISO 8601形式
  is_feasible: boolean | null // 希望納期に間に合うか
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

/**
 * 注文分割時の1明細分のデータ型
 */
export interface OrderSplitLineItem {
  product_id: number
  quantity: number
  desired_deadline: string
  customer_id?: number
  customer_certainty?: 'confirmed' | 'forecast' | 'forecast_tentative'
  extracted_product_name?: string
}

/**
 * 注文分割リクエストのデータ型
 */
export interface OrderSplitRequest {
  line_items: OrderSplitLineItem[]
}

/**
 * 注文分割結果のデータ型
 */
export interface OrderSplitResponse {
  original_order_id: number
  created_orders: Order[]
}

/**
 * 一括承認結果の1件分
 */
export interface OrderBulkApproveResultItem {
  order_id: number
  status: 'confirmed' | 'error'
  detail?: unknown
}

/**
 * 一括承認結果のデータ型
 */
export interface OrderBulkApproveResponse {
  results: OrderBulkApproveResultItem[]
}

/**
 * 納期超過の下書き受注を一括で送品済みにした結果のデータ型（Issue #367）
 */
export interface ShipOverdueDraftsResponse {
  shipped_count: number
  order_ids: number[]
}

/**
 * 承認ワークフロー監査ログのデータ型（iso_officer / president / platform_admin のみ閲覧可）
 */
export interface OrderApprovalLog {
  id: string
  order_id: number
  order_number: string | null
  action: 'request_approval' | 'approve' | 'reject' | 'withdraw'
  actor_user_id: string
  actor_full_name: string | null
  actor_email: string | null
  reason: string | null
  created_at: string
}

/**
 * 受信受注メール（order_attachments のステージング行）ごとの処理結果サマリ（Issue #357）
 *
 * 「パースは成功したが起票0件」（全明細が重複スキップ等）のケースを、
 * メーラーを開かずに追跡できるようにするための一覧用データ型。
 */
export interface EmailIntakeResult {
  id: string
  received_at: string
  customer_id: number | null
  customer_name: string | null
  original_filename: string | null
  has_attachment: boolean
  content_type: string | null
  parse_status: string
  gmail_message_id: string | null
  gmail_url: string | null
  signed_url: string | null
  created_order_count: number
  created_order_ids: number[]
  parse_log_reasons: string[]
}

/**
 * 注文添付ファイルのデータ型
 */
export interface OrderAttachment {
  id: string
  order_id: number
  storage_path: string
  original_filename: string
  content_type: string | null
  size_bytes: number | null
  parse_status:
    | 'pending'
    | 'success'
    | 'failed_encrypted'
    | 'failed_image'
    | 'failed_no_attachment'
  signed_url: string
  created_at: string
}
