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
 * 製品IDから製品名を取得
 */
export function getProductName(productId: number, products?: Product[]): string {
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
    draft:     "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
    confirmed: "bg-green-100 text-green-800 hover:bg-green-100",
    completed: "bg-blue-100 text-blue-800 hover:bg-blue-100",
    canceled:  "bg-gray-100 text-gray-500 hover:bg-gray-100",
  }
  return classes[status] ?? ""
}
