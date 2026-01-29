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
    draft: "下書き",
    confirmed: "確定",
    completed: "完了",
    canceled: "キャンセル",
  }
  return statusLabels[status] || status
}
