import {
  SHIPMENT_FILE_EXTENSIONS,
  SHIPMENT_FILE_MAX_BYTES,
} from "@/types/shipment-file"

/** 選んだファイルを送る前に確かめる。通れば null、通らなければ画面に出す理由 (Issue #662) */
export function validateShipmentFile(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!SHIPMENT_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `${SHIPMENT_FILE_EXTENSIONS.join(" / ")} のファイルを選んでください`
  }
  if (file.size === 0) return "空のファイルです"
  if (file.size > SHIPMENT_FILE_MAX_BYTES) return "ファイルが大きすぎます（20MBまで）"
  return null
}

export function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`
}
