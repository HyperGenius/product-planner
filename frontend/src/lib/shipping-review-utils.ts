import type {
  ShipmentUnmatchedGroup,
  ShipmentUnmatchedList,
  ShipmentUnmatchedStatus,
} from "@/types/shipment"

/**
 * 送品の消し込みのカード（Issue #682）。
 * 「送品の候補」（受注を起点に送品済みにする候補）と「要確認」（受注に当たらない弥生の明細）
 */
export const SHIPPING_CARDS = ["candidates", "review"] as const
export type ShippingCard = (typeof SHIPPING_CARDS)[number]
export const DEFAULT_SHIPPING_CARD: ShippingCard = "candidates"

/** URL のハッシュ（外部入力）を既知のカードに寄せる。知らない値は既定のカード */
export function toValidShippingCard(hash: string): ShippingCard {
  const value = hash.replace(/^#/, "")
  return SHIPPING_CARDS.find((card) => card === value) ?? DEFAULT_SHIPPING_CARD
}

/** 要確認の原因（見出し）の並び。Backend `UNMATCHED_ENTRY_STATUSES` と揃える */
export const UNMATCHED_STATUSES: readonly ShipmentUnmatchedStatus[] = [
  "unmatched_customer",
  "unmatched_product",
  "no_order",
  "ambiguous",
]

export interface UnmatchedStatusMeta {
  label: string
  /** 見出しに1回だけ出す説明（行ごとに繰り返さない） */
  hint: string
  /** 直す画面。受注が区別できないときは行ごとに候補の受注へのリンクを出すので null */
  action: { label: string; href: string } | null
}

export const UNMATCHED_STATUS_META: Record<ShipmentUnmatchedStatus, UnmatchedStatusMeta> = {
  unmatched_customer: {
    label: "得意先が未照合",
    hint: "弥生の得意先がどの顧客か分かりません。弥生の名寄せで得意先に顧客をひも付けてください",
    action: { label: "弥生の名寄せ（得意先）", href: "/orders/shipment-names#customers" },
  },
  unmatched_product: {
    label: "商品コードが未照合",
    hint: "弥生の商品コードがどの製品か分かりません。弥生の名寄せで製品を対応付けるか、送料などは対象外にしてください",
    action: { label: "弥生の名寄せ（商品）", href: "/orders/shipment-names#products" },
  },
  no_order: {
    label: "受注が無い（起票漏れ）",
    hint: "弥生では送品済みですが、当たる受注がありません。注文書を確かめて受注を起票してください",
    action: { label: "受注の新規作成", href: "/orders/new" },
  },
  ambiguous: {
    label: "受注が区別できない",
    hint: "候補の受注が複数あります。候補の受注の希望納期・注文番号が弥生の備考と合っているか確かめてください",
    action: null,
  },
}

/** 要確認の件数（直す単位＝まとめた行の数。上限で切る前） */
export function countUnmatchedGroups(list: ShipmentUnmatchedList | undefined): number | null {
  if (!list) return null
  return UNMATCHED_STATUSES.reduce((sum, status) => sum + (list.counts[status] ?? 0), 0)
}

/** まとめた行を原因ごとに分ける（並びは API の順のまま） */
export function groupUnmatchedByStatus(
  items: readonly ShipmentUnmatchedGroup[],
): Record<ShipmentUnmatchedStatus, ShipmentUnmatchedGroup[]> {
  const grouped = Object.fromEntries(
    UNMATCHED_STATUSES.map((status) => [status, [] as ShipmentUnmatchedGroup[]]),
  ) as Record<ShipmentUnmatchedStatus, ShipmentUnmatchedGroup[]>
  for (const item of items) grouped[item.status]?.push(item)
  return grouped
}
