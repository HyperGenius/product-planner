import { getStatusLabel, type EffectiveOrderStatus } from "@/lib/order-utils"
import type {
  ProductMergeBlocker,
  ProductMergeBlockerReason,
  ProductMergeCandidate,
} from "@/types/product"

/**
 * 重複製品の統合画面（Issue #515）の表示規則。
 */

/** 正しさの順位（Backend `correctness_rank()`）のラベル */
export const MERGE_RANK_LABELS: Record<number, string> = {
  3: "工程時間（小数まで）",
  2: "工程時間あり",
  1: "工程のみ",
  0: "工程なし",
}

const ORDER_STATUSES: readonly EffectiveOrderStatus[] = [
  "draft",
  "pending_approval",
  "confirmed",
  "in_progress",
  "shipped",
  "completed",
  "canceled",
]

/** API が返す受注ステータス（文字列）のラベル。未知の値はそのまま出す */
export function orderStatusLabel(status: string): string {
  return (ORDER_STATUSES as readonly string[]).includes(status)
    ? getStatusLabel(status as EffectiveOrderStatus)
    : status
}

/** 受注件数（ステータス別）を「確定 2 / 送品済み 1」の形にする。受注が無ければ null */
export function formatOrderCounts(counts: Record<string, number>): string | null {
  const parts = ORDER_STATUSES.filter((s) => counts[s]).map(
    (s) => `${getStatusLabel(s)} ${counts[s]}`
  )
  const unknown = Object.entries(counts)
    .filter(([s, n]) => n && !(ORDER_STATUSES as readonly string[]).includes(s))
    .map(([s, n]) => `${s} ${n}`)
  const all = [...parts, ...unknown]
  return all.length > 0 ? all.join(" / ") : null
}

/**
 * 候補を統合される側にできない理由。統合できるなら null。
 * 接頭辞が残す製品と違う候補（有無の違いを含む）は顧客ごとの別製品の想定なので統合しない。
 */
export function mergeIneligibleReason(
  candidate: ProductMergeCandidate,
  keep: ProductMergeCandidate | null
): string | null {
  if (keep === null || candidate.id === keep.id) return null
  if (candidate.prefix_key !== keep.prefix_key) {
    return "接頭辞が残す製品と違うため統合できません（顧客ごとの別製品の可能性があります）"
  }
  return null
}

/** 残す製品と、チェックを外した候補を除いた、統合される製品の ID */
export function selectMergeProductIds(
  candidates: ProductMergeCandidate[],
  keepId: number | null,
  excludedIds: ReadonlySet<number>
): number[] {
  const keep = candidates.find((c) => c.id === keepId) ?? null
  if (keep === null) return []
  return candidates
    .filter(
      (c) =>
        c.id !== keep.id &&
        !excludedIds.has(c.id) &&
        mergeIneligibleReason(c, keep) === null
    )
    .map((c) => c.id)
}

const BLOCKER_LABELS: Record<ProductMergeBlockerReason, string> = {
  spec_mismatch: "直径・長さ・材質が残す製品と違います",
  prefix_mismatch: "接頭辞が残す製品と違います",
  order_conflict: "同じ顧客・同じ納期の受注が付け替え先にあります",
  routing_mismatch: "スケジュール済みの工程が残す製品にありません",
}

function orderLabel(orderNumber: string | null, orderId: number | null): string {
  return orderNumber ?? (orderId !== null ? `ID ${orderId}` : "")
}

/** 統合を止める理由の説明文 */
export function blockerMessage(blocker: ProductMergeBlocker): string {
  const label = BLOCKER_LABELS[blocker.reason]
  switch (blocker.reason) {
    case "order_conflict": {
      const status = blocker.order_status ? `（${orderStatusLabel(blocker.order_status)}）` : ""
      const conflicting = orderLabel(
        blocker.conflicting_order_number,
        blocker.conflicting_order_id
      )
      return `${label}: 受注 ${orderLabel(blocker.order_number, blocker.order_id)}${status} と ${conflicting} が衝突します`
    }
    case "routing_mismatch":
      return `${label}: 受注 ${orderLabel(blocker.order_number, blocker.order_id)} の工程 ${blocker.sequence_order} 番`
    default:
      return label
  }
}
