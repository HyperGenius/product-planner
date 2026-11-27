import {
  SHIPPING_PREREQUISITE_META,
  SHIPPING_WORK_META,
  formatWorkCount,
  type ShippingWorkCount,
} from "@/lib/shipping-worklist-utils"

/**
 * 送品の消し込みのハブの、前回見たときからの件数の増減（Issue #694、Epic #690）。
 *
 * 名寄せ・起票・送品済みにするを済ませてハブに戻ったとき、上流の作業が①③・前提の件数に効いたことを見せる。
 * 件数は閲覧者ごとの補助なので sessionStorage に置く（`useShippingCountChanges()`）。保存した値は外部入力として
 * `parseShippingCountSnapshot()` で形を検証してから使う
 */

/** 増減を見る件数（並びは表示の順。前提 → ①②③）。日報の参考は振り分けの対象ではないので見ない */
export const SHIPPING_COUNT_HISTORY_KINDS = [
  "customer",
  "product",
  "ambiguous",
  "ship",
  "confirm",
  "register",
] as const

export type ShippingCountHistoryKind = (typeof SHIPPING_COUNT_HISTORY_KINDS)[number]

/** 増減の行の見出しと単位（ハブ・各ページと同じ見出し・単位を使う） */
export const SHIPPING_COUNT_HISTORY_META: Record<
  ShippingCountHistoryKind,
  { label: string; unit: string }
> = {
  customer: { label: "未登録の得意先", unit: SHIPPING_PREREQUISITE_META.customer.unit },
  product: { label: "未登録の商品", unit: SHIPPING_PREREQUISITE_META.product.unit },
  ambiguous: {
    label: "送り先を決められない明細",
    unit: SHIPPING_PREREQUISITE_META.ambiguous.unit,
  },
  ship: { label: `① ${SHIPPING_WORK_META.ship.label}`, unit: SHIPPING_WORK_META.ship.unit },
  confirm: { label: `② ${SHIPPING_WORK_META.confirm.label}`, unit: SHIPPING_WORK_META.confirm.unit },
  register: {
    label: `③ ${SHIPPING_WORK_META.register.label}`,
    unit: SHIPPING_WORK_META.register.unit,
  },
}

export interface ShippingCountValue {
  value: number
  /** 一覧が上限で切られていて、実際はこの件数より多い */
  atLeast: boolean
}

export type ShippingCountSnapshot = Record<ShippingCountHistoryKind, ShippingCountValue>

/**
 * ハブの件数から保存する値を作る。どれかが取得中・取得に失敗していれば null（途中の件数を保存すると、
 * 次に見たときに実際には変わっていない増減が出る）
 */
export function buildShippingCountSnapshot(
  counts: Record<ShippingCountHistoryKind, ShippingWorkCount>,
): ShippingCountSnapshot | null {
  const snapshot: Partial<ShippingCountSnapshot> = {}
  for (const kind of SHIPPING_COUNT_HISTORY_KINDS) {
    const count = counts[kind]
    if (count.isError || count.value === null) return null
    snapshot[kind] = { value: count.value, atLeast: count.atLeast ?? false }
  }
  return snapshot as ShippingCountSnapshot
}

function isCountValue(value: unknown): value is ShippingCountValue {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.value === "number" &&
    Number.isInteger(v.value) &&
    v.value >= 0 &&
    typeof v.atLeast === "boolean"
  )
}

/** 保存した値（外部入力）を読む。形が合わなければ null（増減を出さない） */
export function parseShippingCountSnapshot(raw: string | null): ShippingCountSnapshot | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const snapshot: Partial<ShippingCountSnapshot> = {}
  for (const kind of SHIPPING_COUNT_HISTORY_KINDS) {
    const value = record[kind]
    if (!isCountValue(value)) return null
    snapshot[kind] = { value: value.value, atLeast: value.atLeast }
  }
  return snapshot as ShippingCountSnapshot
}

export interface ShippingCountChange {
  kind: ShippingCountHistoryKind
  label: string
  /** 前回の件数（単位付き。「5商品」） */
  from: string
  /** 今の件数（単位付き） */
  to: string
}

/** 前回から変わった件数だけを、表示の順に返す */
export function diffShippingCounts(
  previous: ShippingCountSnapshot,
  current: ShippingCountSnapshot,
): ShippingCountChange[] {
  const format = (kind: ShippingCountHistoryKind, count: ShippingCountValue) =>
    formatWorkCount(
      { value: count.value, isError: false, atLeast: count.atLeast },
      SHIPPING_COUNT_HISTORY_META[kind].unit,
    )
  return SHIPPING_COUNT_HISTORY_KINDS.filter(
    (kind) =>
      previous[kind].value !== current[kind].value ||
      previous[kind].atLeast !== current[kind].atLeast,
  ).map((kind) => ({
    kind,
    label: SHIPPING_COUNT_HISTORY_META[kind].label,
    from: format(kind, previous[kind]),
    to: format(kind, current[kind]),
  }))
}
