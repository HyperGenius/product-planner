/** 弥生販売のエクスポート（送品ファイル）。Backend の ShipmentFile* スキーマと揃える (Issue #662 / #667) */

export interface ShipmentFileItem {
  id: string
  file_name: string
  /** agent: 日報エージェント端末が共有フォルダから回収 / web: アプリからアップロード */
  source: "agent" | "web"
  size_bytes: number
  received_at: string
  /** 解析の状態（Issue #667） */
  parse_status: ShipmentParseStatus
  /** 解析エラーの分類（`SHIPMENT_PARSE_ERROR_LABELS` のキー） */
  parse_error: string | null
  parsed_at: string | null
  /** 帳票の3行目の期間（"YYYY-MM-DD"） */
  period_start: string | null
  period_end: string | null
  /** ファイルから読めた商品の行数 */
  entry_count: number | null
  /** 売上日が無い・期間の外で保存しなかった行数 */
  skipped_count: number | null
  /** replaced: 期間のすべての日を置き換えた / partial: 一部の日は新しいファイルが残った / stale: 反映なし */
  replace_result: "replaced" | "partial" | "stale" | null
}

export type ShipmentParseStatus = "pending" | "parsed" | "unsupported" | "failed"

export interface ShipmentFileList {
  last_received_at: string | null
  files: ShipmentFileItem[]
}

export interface ShipmentFileUploadResult {
  status: "stored" | "duplicate"
  sha256: string
}

/** アップロードできるロール。Backend の SHIPMENT_FILE_UPLOAD_ROLES と揃える */
export const SHIPMENT_FILE_UPLOAD_ROLES = ["president", "order_handler", "platform_admin"] as const

/** 受け付ける拡張子。Backend の ALLOWED_EXTENSIONS と揃える */
export const SHIPMENT_FILE_EXTENSIONS = [".xlsx", ".csv", ".txt"] as const

/** 受信上限。Backend の MAX_SHIPMENT_FILE_BYTES と揃える */
export const SHIPMENT_FILE_MAX_BYTES = 20 * 1024 * 1024
