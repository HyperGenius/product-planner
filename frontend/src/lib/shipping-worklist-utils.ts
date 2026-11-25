import { jstTodayIso } from "@/lib/order-utils"
import { buildShippingRows, type ShippingRow } from "@/lib/shipping-candidate-utils"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { Order } from "@/types/order"
import type {
  ShipmentOrderMatch,
  ShipmentOrderReview,
  ShipmentOrderReviewList,
  ShipmentUnmatchedGroup,
  ShipmentUnmatchedList,
  ShipmentUnmatchedStatus,
} from "@/types/shipment"

/**
 * 送品の消し込みの分類（Issue #691、Epic #690）。
 *
 * 注文と弥生の明細を「次の行動」で振り分ける。どの注文・明細も、①送品済みにする・②出荷を確かめる・
 * ③受注を起票する・前提（先に片付けること）・対象外の**どれか1か所にだけ**置く。日報が追いついていない
 * 注文（参考）は振り分けの対象にせず、①②の行の印と件数として重ねて示す。
 *
 * ハブの件数と各ページの行は、必ず `classifyShippingWorklist()` の結果から出す（別々に数えない）。
 * 分類ルール表は docs/features/shipment-file-import.md の「送品の消し込みの分類」
 */

/** 振り分けの行き先 */
export type ShippingWorkKind = "ship" | "confirm" | "register" | "prerequisite" | "excluded"

/** 前提（①②③より先に片付けること）の種類 */
export type ShippingPrerequisiteKind = "customer" | "product" | "ambiguous"

/** 注文の行き先（①・②・対象外） */
export type ShippingOrderPlacement = Extract<ShippingWorkKind, "ship" | "confirm" | "excluded">

export interface ShippingWorkMeta {
  /** 見出し・ボタン（動詞で書く） */
  label: string
  /** 件数の単位 */
  unit: string
}

/** 行き先ごとの見出しと件数の単位（1か所に置く） */
export const SHIPPING_WORK_META: Record<Exclude<ShippingWorkKind, "prerequisite">, ShippingWorkMeta> = {
  ship: { label: "送品済みにする", unit: "注文" },
  confirm: { label: "出荷を確かめる", unit: "注文" },
  // (得意先, 商品コード) のまとまりが1行。備考の納期分は行の中に並べる
  register: { label: "受注を起票する", unit: "商品" },
  excluded: { label: "対象外", unit: "注文" },
}

/**
 * 前提の種類ごとの見出しと件数の単位。得意先は得意先の数、商品・受注の見分けは
 * (得意先, 商品コード) のまとまりの数（弥生の名寄せの画面と同じ単位）
 */
export const SHIPPING_PREREQUISITE_META: Record<ShippingPrerequisiteKind, ShippingWorkMeta> = {
  customer: { label: "得意先を名寄せする", unit: "得意先" },
  product: { label: "商品を名寄せする", unit: "商品" },
  ambiguous: { label: "送品先の受注を見分ける", unit: "商品" },
}

/** 前提の並び（片付ける順） */
export const SHIPPING_PREREQUISITE_KINDS: readonly ShippingPrerequisiteKind[] = [
  "customer",
  "product",
  "ambiguous",
]

/** 日報の参考（振り分けの対象にせず、件数とリンクだけを置く） */
export const SHIPPING_DAILY_REPORT_META: ShippingWorkMeta = {
  label: "弥生の送品数に日報の実績が届いていない注文",
  unit: "注文",
}

/**
 * 弥生の明細（受注が1件に決まらなかったもの）の突合の状態 → 行き先。
 *
 * - 得意先・商品が未照合: 名寄せしないと受注と突き合わせられないので前提
 * - 受注が区別できない（`ambiguous`）: 直さないと数量が受注に入らず①に進めないので前提。
 *   直す手段は候補の受注の顧客注文番号・希望納期を弥生の備考に合わせること
 * - 受注が無い: ③受注を起票する
 *
 * 突合で受注が1件に決まった明細（`matched`）は明細としては出さず、受注のステータスに従う
 * （確定済・生産中ならその注文の①②・対象外、下書き・承認待ち・送品済みなら対象外）。
 * 対象外にした明細（`ignored`）・直近60日より前の明細も対象外（API が返さない）
 */
export const UNMATCHED_STATUS_PLACEMENT: Record<
  ShipmentUnmatchedStatus,
  { kind: "prerequisite"; prerequisite: ShippingPrerequisiteKind } | { kind: "register" }
> = {
  unmatched_customer: { kind: "prerequisite", prerequisite: "customer" },
  unmatched_product: { kind: "prerequisite", prerequisite: "product" },
  ambiguous: { kind: "prerequisite", prerequisite: "ambiguous" },
  no_order: { kind: "register" },
}

/**
 * 注文の行き先。上から順に最初に当たったものにする
 *
 * 1. 弥生の送品数量が受注数量に達した（`yayoi_shipped`）→ ①
 * 2. 最終工程完了・納期超過・納期まで7日未満のどれか → ②
 * 3. それ以外 → 対象外
 */
export function placeShippingOrder(row: ShippingRow): ShippingOrderPlacement {
  if (row.reasons.includes("yayoi_shipped")) return "ship"
  if (row.reasons.length > 0) return "confirm"
  return "excluded"
}

/** 行に重ねて出す印（振り分けには使わない） */
export interface ShippingOrderMarks {
  /** 日報が追いついていない（弥生の送品数量が、日報で追う最後の工程の良品数を超えている） */
  dailyReport: ShipmentOrderReview | null
  /** 分納の途中: 弥生の送品数量（0より多く、受注数量に達していない）。それ以外は null */
  partialShippedQty: number | null
  /** この注文が候補に入っている、受注が区別できない明細の件数（明細そのものは前提に置く） */
  ambiguousEntryCount: number
}

export interface ShippingWorklistOrder extends ShippingRow {
  placement: ShippingOrderPlacement
  marks: ShippingOrderMarks
}

export function buildShippingOrderMarks(
  shipment: ShipmentOrderMatch | null,
  review: ShipmentOrderReview | undefined,
): ShippingOrderMarks {
  const partial =
    shipment !== null && !shipment.is_fully_shipped && shipment.shipped_qty > 0
      ? shipment.shipped_qty
      : null
  return {
    dailyReport: review ?? null,
    partialShippedQty: partial,
    ambiguousEntryCount: shipment?.ambiguous_entries.length ?? 0,
  }
}

export interface ShippingWorklistCounts {
  ship: number
  confirm: number
  excluded: number
  /** 弥生の明細の一覧が届いていない間は null */
  register: number | null
  prerequisite: Record<ShippingPrerequisiteKind, number> | null
  /** 日報の参考。日報が追いついていない注文の一覧が届いていない間は null */
  dailyReport: number | null
}

export interface ShippingWorklist {
  /** ① 送品済みにする（並びは `compareShippingRows()`） */
  ship: ShippingWorklistOrder[]
  /** ② 出荷を確かめる */
  confirm: ShippingWorklistOrder[]
  /** 対象外の注文（確定済・生産中で、①②のどれにも当たらない） */
  excludedOrders: ShippingWorklistOrder[]
  /** ③ 受注を起票する（(得意先, 商品コード) のまとまり） */
  register: ShipmentUnmatchedGroup[]
  /** 前提（種類ごと） */
  prerequisite: Record<ShippingPrerequisiteKind, ShipmentUnmatchedGroup[]>
  /** 日報の参考（①②・対象外の注文のうち、日報が追いついていないもの。重なってよい） */
  dailyReportOrders: ShippingWorklistOrder[]
  counts: ShippingWorklistCounts
  /** 弥生の明細の一覧が原因ごとの上限で切られている（③・前提の件数が実際より少ない） */
  truncated: boolean
}

export interface ShippingWorklistSources {
  orders: readonly Order[]
  /** `GET /daily-reports/order-progress` の行 */
  progressItems?: readonly ProcessProgress[]
  /** `GET /shipments/order-matches` の行 */
  shipmentMatches?: readonly ShipmentOrderMatch[]
  /** `GET /shipments/unmatched-entries` */
  unmatchedEntries?: ShipmentUnmatchedList
  /** `GET /shipments/order-reviews` */
  orderReviews?: ShipmentOrderReviewList
  /** JST の今日（"YYYY-MM-DD"）。省略時は現在時刻から求める */
  todayIso?: string
}

function emptyPrerequisite(): Record<ShippingPrerequisiteKind, ShipmentUnmatchedGroup[]> {
  return { customer: [], product: [], ambiguous: [] }
}

/** 前提の件数。得意先は得意先の数、ほかは (得意先, 商品コード) のまとまりの数 */
export function countPrerequisite(
  prerequisite: Record<ShippingPrerequisiteKind, ShipmentUnmatchedGroup[]>,
): Record<ShippingPrerequisiteKind, number> {
  return {
    customer: new Set(prerequisite.customer.map((g) => g.customer_code_key)).size,
    product: prerequisite.product.length,
    ambiguous: prerequisite.ambiguous.length,
  }
}

/** 注文と弥生の明細を、分類ルール表どおりに振り分ける */
export function classifyShippingWorklist(sources: ShippingWorklistSources): ShippingWorklist {
  const rows = buildShippingRows(
    sources.orders,
    sources.progressItems,
    sources.todayIso ?? jstTodayIso(),
    sources.shipmentMatches,
  )
  const reviewByOrder = new Map(sources.orderReviews?.items.map((r) => [r.order_id, r]))

  const ship: ShippingWorklistOrder[] = []
  const confirm: ShippingWorklistOrder[] = []
  const excludedOrders: ShippingWorklistOrder[] = []
  const placed = { ship, confirm, excluded: excludedOrders }
  for (const row of rows) {
    const order: ShippingWorklistOrder = {
      ...row,
      placement: placeShippingOrder(row),
      marks: buildShippingOrderMarks(row.shipment, reviewByOrder.get(row.order.id)),
    }
    placed[order.placement].push(order)
  }

  const register: ShipmentUnmatchedGroup[] = []
  const prerequisite = emptyPrerequisite()
  for (const group of sources.unmatchedEntries?.items ?? []) {
    const placement = UNMATCHED_STATUS_PLACEMENT[group.status]
    if (!placement) continue
    if (placement.kind === "register") register.push(group)
    else prerequisite[placement.prerequisite].push(group)
  }

  const dailyReportOrders = [...ship, ...confirm, ...excludedOrders].filter(
    (o) => o.marks.dailyReport !== null,
  )
  const hasEntries = sources.unmatchedEntries !== undefined

  return {
    ship,
    confirm,
    excludedOrders,
    register,
    prerequisite,
    dailyReportOrders,
    counts: {
      ship: ship.length,
      confirm: confirm.length,
      excluded: excludedOrders.length,
      register: hasEntries ? register.length : null,
      prerequisite: hasEntries ? countPrerequisite(prerequisite) : null,
      dailyReport: sources.orderReviews ? dailyReportOrders.length : null,
    },
    truncated: sources.unmatchedEntries?.truncated ?? false,
  }
}
