/** 弥生販売の売上伝票 CSV（送品ファイル）。Backend の ShipmentFile* スキーマと揃える (Issue #662) */

export interface ShipmentFileItem {
  id: string
  file_name: string
  /** agent: 日報エージェント端末が共有フォルダから回収 / web: アプリからアップロード */
  source: "agent" | "web"
  size_bytes: number
  received_at: string
}

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
