/**
 * 注文のデータ型
 */
export interface Order {
  id: number
  order_no: string | null
  /** 顧客側の注文番号／注文No.（Issue #366。観察用・社内採番の order_no とは別物） */
  customer_order_no?: string | null
  product_id: number | null
  extracted_product_name?: string | null
  customer_id?: number
  /**
   * 数量。メール起票（source_type='email'）で数量を抽出できなかった場合は `null`（0 ではない）で
   * 保存され、担当者が後から確認する運用（migration 20260618000000_gmail_intake_v2.sql で
   * NOT NULL を解除）。この状態の受注は基本的に status='draft'。表示側は null セーフに扱うこと（Issue #414）
   */
  quantity: number | null
  desired_deadline?: string // 日付のみ (YYYY-MM-DD)、時刻情報は持たない
  confirmed_deadline?: string // 承認確定時に算出される完成予定日 (YYYY-MM-DD)。承認前は未設定
  /**
   * `POST /orders/{id}/simulate` が算出した完成見込み日 (YYYY-MM-DD)。承認前の「シミュ納期」表示に使う。
   * product_id / quantity / desired_deadline / scheduling_start_date の編集で is_scheduled とともにクリアされる（Issue #394）
   */
  simulated_deadline?: string
  /** 受注起票日（システムに受注が登録された日時）。作業開始日とは別物（Issue #372） */
  order_date?: string | null
  /** 作業開始日（工場が着手する日、YYYY-MM-DD）。未設定なら実行日時から着手。過去日は president / platform_admin のみ設定可（Issue #372） */
  scheduling_start_date?: string | null
  status: 'draft' | 'pending_approval' | 'confirmed' | 'in_progress' | 'shipped' | 'completed' | 'canceled'
  /** 承認依頼を送信した日時 (ISO 8601 / timestamptz)。pending_approval 以外・既存データでは未設定（Issue #402） */
  approval_requested_at?: string | null
  /** 承認依頼者の auth.users.id（非正規化。Issue #402） */
  approval_requested_by?: string | null
  /** 承認依頼者の表示名（profiles.full_name、なければ email）。不明時は null（Issue #402） */
  approval_requested_by_name?: string | null
  /** 承認確定（confirm 操作）を行った日時 (ISO 8601 / timestamptz)。承認前・既存データでは未設定 */
  confirmed_at?: string | null
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
  /** 作業開始日 (YYYY-MM-DD)。null で解除。過去日は president / platform_admin のみ（Issue #372） */
  scheduling_start_date?: string | null
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
  /** 顧客側の注文番号／注文No.（Issue #366。Backend は str | None）*/
  customer_order_no?: string | null
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
  /** 作業開始日 (YYYY-MM-DD)。未指定なら実行日時から着手。過去日は president / platform_admin のみ（Issue #372） */
  scheduling_start_date?: string
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
 * 受信受注メール1件の処理結果を固定した3値の観点（Issue #422）。
 * サーバー側（`_derive_email_intake_outcome`）で導出される。フロントでは再計算しない。
 *
 * - `created`: 1件以上の注文が新規起票された（通常フロー。レビューして確定）
 * - `skipped`: 正常に処理されたが意図的に起票しなかった（重複・対象外等。基本対応不要）
 * - `failed`: 抽出・処理が完了できず起票に至らなかった（手動起票・再送など対応必須）
 */
export type EmailIntakeOutcome = 'created' | 'skipped' | 'failed'

/**
 * 受信受注メール（order_attachments のステージング行）ごとの処理結果サマリ（Issue #357）
 *
 * 「パースは成功したが起票0件」（全明細が重複スキップ等）のケースを、
 * メーラーを開かずに追跡できるようにするための一覧用データ型。
 * `outcome` は運用者が取るべきアクションを1つの軸に固定したもの（Issue #422）。
 * `parse_status` 等の生フィールドは詳細（展開表示）用に残す。
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
  /** parse_status / created_order_count / parse_log_reasons からの導出値（Issue #422） */
  outcome: EmailIntakeOutcome
  /** outcome='created' だが要確認（品番未照合・複数受注の疑い等） */
  needs_attention: boolean
  /** 読み取り不能PDF等で中身が空の下書きだけが起票された（outcome='failed'） */
  empty_draft: boolean
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
