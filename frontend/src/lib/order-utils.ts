import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

/**
 * 製品IDから製品名を取得
 */
export function getProductName(productId: number, products?: Product[]): string {
  const product = products?.find((p) => p.id === productId)
  return product ? `${product.code} - ${product.name}` : "不明"
}

/**
 * ステータスの日本語ラベルを取得
 */
export function getStatusLabel(status: Order["status"]): string {
  const statusLabels: Record<Order["status"], string> = {
    pending: "保留中",
    confirmed: "確定",
    in_progress: "進行中",
    completed: "完了",
  }
  return statusLabels[status] || status
}
