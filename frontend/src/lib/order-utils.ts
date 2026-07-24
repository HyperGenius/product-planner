import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

export type StatusFilter = "" | "draft" | "confirmed" | "completed" | "canceled"
export type SortKey = "created_at_desc" | "created_at_asc" | "desired_deadline_asc"

export const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "すべて", value: "" },
  { label: "下書き", value: "draft" },
  { label: "確定済", value: "confirmed" },
  { label: "完了", value: "completed" },
  { label: "キャンセル", value: "canceled" },
]

export const DEFAULT_SORT: SortKey = "desired_deadline_asc"

export const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "登録日（新しい順）", value: "created_at_desc" },
  { label: "登録日（古い順）", value: "created_at_asc" },
  { label: "希望納期（近い順）", value: "desired_deadline_asc" },
]

export function filterOrder(order: Order, statusFilter: StatusFilter): boolean {
  if (statusFilter) return order.status === statusFilter
  return true
}

/**
 * 日付のみを表す文字列 (例: "2026-10-01" や "2026-10-01T00:00:00")
 * をタイムゾーンの影響を受けずに "yyyy/MM/dd" 表示へ整形する。
 * `new Date()` でパースすると環境のタイムゾーンによって日付がずれるため使用しない。
 */
export function formatDeadlineDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  return dateStr.slice(0, 10).replace(/-/g, "/")
}

/**
 * 日付のみを表す文字列を `<input type="date">` が要求する "YYYY-MM-DD" 形式に整形する。
 */
export function toDateInputValue(dateStr: string | null | undefined): string {
  if (!dateStr) return ""
  return dateStr.slice(0, 10)
}

export function compareOrders(a: Order, b: Order, sortKey: SortKey): number {
  if (sortKey === "created_at_desc" || sortKey === "created_at_asc") {
    if (!a.created_at && !b.created_at) return 0
    if (!a.created_at) return 1
    if (!b.created_at) return -1
    const timeA = new Date(a.created_at).getTime()
    const timeB = new Date(b.created_at).getTime()
    return sortKey === "created_at_desc" ? timeB - timeA : timeA - timeB
  }
  if (!a.desired_deadline && !b.desired_deadline) return 0
  if (!a.desired_deadline) return 1
  if (!b.desired_deadline) return -1
  return a.desired_deadline.localeCompare(b.desired_deadline)
}

/**
 * 製品IDから製品名を取得。productIdがnull（自動起票時に製品未マッチ）の場合は、
 * 抽出済みの生テキスト（extractedProductName）があればそれをフォールバック表示する。
 */
export function getProductName(
  productId: number | null,
  products?: Product[],
  extractedProductName?: string | null
): string {
  if (productId == null) {
    return extractedProductName ? `${extractedProductName}（製品未確定）` : "不明"
  }
  const product = products?.find((p) => p.id === productId)
  if (!product) return "不明"
  return product.code ? `${product.code} - ${product.name}` : product.name
}

/**
 * 顧客IDから顧客名を取得
 */
export function getCustomerName(customerId: number | undefined, customers?: Customer[]): string {
  if (!customerId) return "-"
  const customer = customers?.find((c) => c.id === customerId)
  return customer ? customer.name : "不明"
}

/**
 * ステータスの日本語ラベルを取得
 */
export function getStatusLabel(status: Order["status"]): string {
  const statusLabels: Record<Order["status"], string> = {
    draft: "下書き",
    confirmed: "確定",
    completed: "完了",
    canceled: "キャンセル",
  }
  return statusLabels[status] || status
}

/**
 * ステータスバッジの Tailwind クラスを取得
 */
export function getStatusBadgeClass(status: Order["status"]): string {
  const classes: Record<Order["status"], string> = {
    draft:      "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
    confirmed:  "bg-green-100 text-green-800 hover:bg-green-100",
    completed:  "bg-blue-100 text-blue-800 hover:bg-blue-100",
    canceled:   "bg-gray-100 text-gray-500 hover:bg-gray-100",
  }
  return classes[status] ?? ""
}

/**
 * 顧客側の確度（PDF/メール文面から抽出した内示・内々示・確定の別）の日本語ラベルを取得。
 * ProductPlanner側のワークフローステータス(status)とは独立した参考情報。
 */
export function getCertaintyLabel(certainty: NonNullable<Order["customer_certainty"]>): string {
  const certaintyLabels: Record<NonNullable<Order["customer_certainty"]>, string> = {
    confirmed: "顧客確定",
    forecast: "内示",
    forecast_tentative: "内々示",
  }
  return certaintyLabels[certainty] || certainty
}

/**
 * 顧客側の確度バッジの Tailwind クラスを取得
 */
export function getCertaintyBadgeClass(
  certainty: NonNullable<Order["customer_certainty"]>
): string {
  const classes: Record<NonNullable<Order["customer_certainty"]>, string> = {
    confirmed:           "bg-green-50 text-green-700 hover:bg-green-50",
    forecast:            "bg-orange-100 text-orange-800 hover:bg-orange-100",
    forecast_tentative:  "bg-purple-100 text-purple-800 hover:bg-purple-100",
  }
  return classes[certainty] ?? ""
}

/**
 * source_raw 中の最初に見つかった「件名: ...」行(先頭とは限らない)を件名として
 * 切り出し、その行より後ろを本文として返す。件名行が見つからない場合は全体を
 * 本文として扱う。
 */
export function splitSubjectAndBody(sourceRaw?: string | null): {
  subject?: string
  body?: string
} {
  if (!sourceRaw) return {}
  const match = sourceRaw.match(/^件名[:：]\s*(.*)$/m)
  if (!match || match.index == null) return { body: sourceRaw }
  const subject = match[1].trim()
  const body = sourceRaw.slice(match.index + match[0].length).replace(/^\s+/, "")
  return { subject: subject || undefined, body: body || undefined }
}
