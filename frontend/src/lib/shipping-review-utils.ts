import type {
  ShipmentOrderReview,
  ShipmentOrderReviewCause,
} from "@/types/shipment"

/** 送品の消し込みのハブ（Issue #692） */
export const SHIPPING_HUB_HREF = "/orders/shipping"

/**
 * ハブから開く作業の一覧のページ（Issue #693、Epic #690）。`/orders/shipping/<page>` に置く。
 * 値は #692 の暫定の一覧のハッシュ（`#ship` 等）と同じにして、古いハッシュをそのままページへ移せるようにしている
 */
export const SHIPPING_PAGES = ["ship", "confirm", "register", "ambiguous", "daily-reports"] as const
export type ShippingPage = (typeof SHIPPING_PAGES)[number]

export function shippingPageHref(page: ShippingPage): string {
  return `${SHIPPING_HUB_HREF}/${page}`
}

/**
 * ハブを古いハッシュで開いたときの移り先（ハッシュは外部入力）。
 * - #692 の暫定の一覧（`#ship` / `#confirm` / `#register` / `#ambiguous` / `#daily-reports`）→ そのページ
 * - #682 の「送品の候補」カード（`#candidates`）→ ①
 * - それ以外（#682 の「要確認」`#review`・知らない値・空）→ null（ハブを出す）
 */
export function shippingPageFromLegacyHash(hash: string): ShippingPage | null {
  const value = hash.replace(/^#/, "")
  if (value === "candidates") return "ship"
  return SHIPPING_PAGES.find((page) => page === value) ?? null
}

// ---------------------------------------------------------------------------
// 日報が未入力の出荷済み注文（Issue #683）
// ---------------------------------------------------------------------------

/** 原因の並び（判定の順）。Backend `REVIEW_CAUSES` と揃える */
export const ORDER_REVIEW_CAUSES: readonly ShipmentOrderReviewCause[] = [
  "no_routing",
  "process_mismatch",
  "customer_or_stock",
  "missing_report",
]

export interface OrderReviewCauseMeta {
  label: string
  /** ①②の行に出す短い表示 */
  short: string
  /** 原因の説明。画面には書かず、ページのヘルプに出す（docs/ui-writing-guidelines.md） */
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
      label: "工程マスタ未登録の実績を見る",
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
    hint: "受注に充てられる日報の実績が見つかりません。現場に日報の記入・取り込みを確認してください。日報の名寄せが済んでいない明細も受注に充てられないので、ここに含まれます",
    owner: null,
    action: { label: "日報の名寄せをする", href: "/master/daily-report-names" },
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
