import type { ShipmentFileItem } from "@/types/shipment-file"
import type {
  ShipmentCustomerItem,
  ShipmentProductAutoMethod,
  ShipmentProductItem,
} from "@/types/shipment"
import { formatDeadlineShort } from "@/lib/order-utils"

/**
 * 弥生の売上明細の解析・名寄せの表示（Issue #667）
 */

/** 解析エラーの分類（Backend `shipment_parsing_service` / `ShipmentParseError.code`）の表示文言 */
export const SHIPMENT_PARSE_ERROR_LABELS: Record<string, string> = {
  unsupported_file_type: "Excel（.xlsx）以外のファイルは解析しません",
  invalid_workbook: "Excel のファイルとして開けませんでした",
  period_not_found: "3行目の期間を読めませんでした",
  header_not_found: "見出し（得意先コード・商品コード等）を読めませんでした",
  parse_failed: "解析に失敗しました",
}

/** ファイルごとの解析結果の1行の表示 */
export function describeShipmentFileParse(file: ShipmentFileItem): {
  label: string
  tone: "muted" | "ok" | "warn" | "error"
} {
  switch (file.parse_status) {
    case "pending":
      return { label: "解析待ち", tone: "muted" }
    case "unsupported":
    case "failed":
      return {
        label:
          (file.parse_error && SHIPMENT_PARSE_ERROR_LABELS[file.parse_error]) ??
          SHIPMENT_PARSE_ERROR_LABELS.parse_failed,
        tone: "error",
      }
    case "parsed": {
      const count = `${(file.entry_count ?? 0).toLocaleString("ja-JP")}行`
      const skipped = file.skipped_count ? `（読み飛ばし ${file.skipped_count}行）` : ""
      if (file.replace_result === "stale") {
        return { label: `${count}・新しいファイルが反映済み`, tone: "muted" }
      }
      if (file.replace_result === "partial") {
        return { label: `${count}・一部の日は新しいファイルが反映済み${skipped}`, tone: "warn" }
      }
      return { label: `${count}${skipped}`, tone: skipped ? "warn" : "ok" }
    }
  }
}

/** 帳票の期間（"10/1〜10/31"） */
export function formatShipmentPeriod(file: ShipmentFileItem): string | null {
  if (!file.period_start || !file.period_end) return null
  return `${formatDeadlineShort(file.period_start)}〜${formatDeadlineShort(file.period_end)}`
}

export const PRODUCT_AUTO_METHOD_LABELS: Record<ShipmentProductAutoMethod, string> = {
  drawing_no: "品名の図番で自動",
  spec: "品名の寸法・材質で自動",
}

export type ShipmentNameState = "linked" | "auto" | "unmatched" | "ignored"

/** 得意先の照合状況 */
export function customerItemState(item: ShipmentCustomerItem): ShipmentNameState {
  if (item.ignored_id) return "ignored"
  if (item.links.length > 0) return "linked"
  if (item.auto_customer_id !== null) return "auto"
  return "unmatched"
}

/** 商品の照合状況 */
export function productItemState(item: ShipmentProductItem): ShipmentNameState {
  if (item.ignored_id || item.customer_ignored) return "ignored"
  if (item.link) return "linked"
  if (item.auto_product_id !== null) return "auto"
  return "unmatched"
}

export const NAME_STATE_LABELS: Record<ShipmentNameState, string> = {
  linked: "対応付け済み",
  auto: "自動で照合",
  unmatched: "未照合",
  ignored: "対象外",
}
