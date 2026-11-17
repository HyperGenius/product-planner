import type {
  ShipmentOrderReview,
  ShipmentOrderReviewCause,
  ShipmentOrderReviewList,
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

// ---------------------------------------------------------------------------
// 日報の進捗が追いついていない受注（Issue #683）
// ---------------------------------------------------------------------------

/** 要確認の中の切り替え。日報が追いついていない受注と、受注に当たらない弥生の明細 */
export type ShippingReviewView = "orders" | "entries"

/** 原因の並び（判定の順）。Backend `REVIEW_CAUSES` と揃える */
export const ORDER_REVIEW_CAUSES: readonly ShipmentOrderReviewCause[] = [
  "no_routing",
  "process_mismatch",
  "customer_or_stock",
  "missing_report",
]

export interface OrderReviewCauseMeta {
  label: string
  /** 送品の候補の行に出す短い表示 */
  short: string
  /** 見出しに1回だけ出す説明（ツールチップにしない。タブレットでも読めるように） */
  hint: string
  /** 直す担当。現場に確認するものは null */
  owner: string | null
  /** 見出しに置く直す画面。製品・受注ごとに直すものは行にリンクを出すので null */
  action: { label: string; href: string } | null
}

export const ORDER_REVIEW_CAUSE_META: Record<ShipmentOrderReviewCause, OrderReviewCauseMeta> = {
  no_routing: {
    label: "製品に工程が無い",
    short: "工程なし",
    hint: "製品の工程ルートが無いため、日報の実績を受注に割り付けられません。製品マスタで工程を登録してください",
    owner: "社長",
    action: null,
  },
  process_mismatch: {
    label: "工程名が日報と合わない",
    short: "工程名の不一致",
    hint: "日報の工程名が製品の工程ルートに無く、実績が割り付けられずに残っています。工程ルートを直すか、日報の名寄せで工程を対応付けてください",
    owner: "社長",
    action: {
      label: "照合状況（工程マスタ未登録）",
      href: "/master/daily-report-coverage#routing",
    },
  },
  customer_or_stock: {
    label: "日報の顧客先が違う／作り置き",
    short: "顧客先違い・作り置き",
    hint: "この製品の実績が、別の顧客先や受注日より前（作り置き）として割り付けられずに残っています。受注詳細の「作り置きからの引き当て」で受注に充ててください",
    owner: "受注担当",
    action: null,
  },
  missing_report: {
    label: "日報の書き漏れ・取り込み漏れ",
    short: "日報の漏れ",
    hint: "受注に充てられる日報の実績が見つかりません。現場に日報の記入・取り込みを確認してください。日報の名寄せで未照合の明細も割り付けに使われないので、ここに含まれます",
    owner: null,
    action: { label: "日報の名寄せ（未照合）", href: "/master/daily-report-names" },
  },
}

/** 同じ製品の受注のまとめ（要確認は製品の単位で出す） */
export interface OrderReviewProductGroup {
  productId: number
  reviews: ShipmentOrderReview[]
  shippedQty: number
  finalGoodQty: number
}

/** 原因ごとに、製品の単位でまとめる（並びは API の順＝受注 ID の順で、製品が最初に出た順） */
export function groupOrderReviews(
  items: readonly ShipmentOrderReview[],
): Record<ShipmentOrderReviewCause, OrderReviewProductGroup[]> {
  const grouped = Object.fromEntries(
    ORDER_REVIEW_CAUSES.map((cause) => [cause, [] as OrderReviewProductGroup[]]),
  ) as Record<ShipmentOrderReviewCause, OrderReviewProductGroup[]>
  for (const item of items) {
    const groups = grouped[item.cause]
    if (!groups) continue
    let group = groups.find((g) => g.productId === item.product_id)
    if (!group) {
      group = { productId: item.product_id, reviews: [], shippedQty: 0, finalGoodQty: 0 }
      groups.push(group)
    }
    group.reviews.push(item)
    group.shippedQty += item.shipped_qty
    group.finalGoodQty += item.final_good_qty
  }
  return grouped
}

/** 日報が追いついていない受注の件数（直す単位＝原因×製品のまとめの数） */
export function countOrderReviewGroups(list: ShipmentOrderReviewList | undefined): number | null {
  if (!list) return null
  return Object.values(groupOrderReviews(list.items)).reduce((sum, g) => sum + g.length, 0)
}

/**
 * 要確認のカードの件数。受注に当たらない明細と日報が追いついていない受注の合計。
 * 片方の取得に失敗しても、取れた方だけで数える（両方とも無い間は null）
 */
export function countShippingReview(
  unmatched: number | null,
  orderReviews: number | null,
): number | null {
  if (unmatched === null && orderReviews === null) return null
  return (unmatched ?? 0) + (orderReviews ?? 0)
}
