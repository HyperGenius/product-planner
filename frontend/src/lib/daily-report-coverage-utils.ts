import { format } from "date-fns"
import type {
  CoverageSummary,
  UnallocatedCategory,
  UnallocatedGroup,
} from "@/types/daily-report-progress"

/**
 * 日報の照合状況の表示ロジック (Issue #542)。
 * 未割当の分類ごとのラベル・現場への問いかけ・集計を持つ。
 */

interface CategoryMeta {
  label: string
  /** 現場にそのまま聞ける問いかけ */
  question: (group: Pick<UnallocatedGroup, "process_name">) => string
  /** ヒアリングで聞く対象か（出荷済みの受注の実績は聞かなくてよい可能性が高い） */
  needsHearing: boolean
}

export const CATEGORY_META: Record<UnallocatedCategory, CategoryMeta> = {
  no_routing_process: {
    label: "工程ルートに無い工程",
    question: (g) => `この製品の工程に「${g.process_name}」がありません。実際の工程順は？`,
    needsHearing: true,
  },
  unapproved_order: {
    label: "承認前の受注のみ",
    question: () => "承認前（下書き・承認待ち）の受注しかありません。承認前に作り始めていますか？",
    needsHearing: true,
  },
  no_order: {
    label: "受注なし",
    question: () => "受注が無いのに作っています。見込み生産？ 受注の登録漏れ？",
    needsHearing: true,
  },
  before_order_date: {
    label: "受注日より前",
    question: () => "受注日より前に作っています。見込み生産？",
    needsHearing: true,
  },
  stocked: {
    label: "作り置き",
    question: () => "受注日より前に作った分です。作り置きの推定に数えています",
    needsHearing: false,
  },
  exceeds_order_qty: {
    label: "受注数を超過",
    question: () => "受注数より多く作っています。予備・不良の見越し？",
    needsHearing: true,
  },
  no_work_date: {
    label: "加工日が空欄",
    question: () => "日報の加工日が空欄です。書き方のルールは？",
    needsHearing: true,
  },
  closed_order_only: {
    label: "出荷済みの受注のみ",
    question: () => "確定済み・生産中の受注がありません（出荷済みの受注の実績の可能性があります）",
    needsHearing: false,
  },
}

/** 分類の表示順（ヒアリングで聞く分類を先に） */
export const CATEGORY_ORDER: UnallocatedCategory[] = [
  "no_routing_process",
  "no_order",
  "unapproved_order",
  "before_order_date",
  "exceeds_order_qty",
  "no_work_date",
  "stocked",
  "closed_order_only",
]

/** 一覧の絞り込み。"hearing" はヒアリングで聞く分類すべて */
export type CategoryFilter = "hearing" | "all" | UnallocatedCategory

export function matchesCategoryFilter(
  group: Pick<UnallocatedGroup, "category">,
  filter: CategoryFilter,
): boolean {
  if (filter === "all") return true
  if (filter === "hearing") return CATEGORY_META[group.category].needsHearing
  return group.category === filter
}

/** 期間（直近 N か月、今月を含む）。null はすべての期間 */
export const PERIOD_OPTIONS: { months: number | null; label: string }[] = [
  { months: 1, label: "今月" },
  { months: 3, label: "直近3か月" },
  { months: 6, label: "直近6か月" },
  { months: 12, label: "直近12か月" },
  { months: null, label: "すべて" },
]

export const DEFAULT_PERIOD_MONTHS = 3

/** 割合（0〜1）。分母が0なら null */
export function ratio(part: number, total: number): number | null {
  return total > 0 ? part / total : null
}

export function formatPercent(value: number | null): string {
  return value === null ? "－" : `${Math.round(value * 100)}%`
}

/** 受注の工程に割り付けできた割合（数量ベース） */
export function allocatedRatio(summary: CoverageSummary): number | null {
  return ratio(summary.allocated_qty, summary.total_qty)
}

export interface ProductWithoutRoutings {
  product_id: number
  product_name: string | null
  product_code: string | null
  qty: number
  row_count: number
  /** 日報に出てきた工程名（数量の多い順） */
  process_names: string[]
}

/**
 * 日報に実績があるのに工程ルートが1件も無い製品（数量の多い順）。
 * 工程ルートが無い製品の実績はすべて `no_routing_process` になるので、それを製品ごとに集める。
 */
export function productsWithoutRoutings(
  groups: readonly UnallocatedGroup[],
): ProductWithoutRoutings[] {
  const byProduct = new Map<number, ProductWithoutRoutings>()
  for (const group of groups) {
    if (group.category !== "no_routing_process" || group.product_has_routings) continue
    const product = byProduct.get(group.product_id) ?? {
      product_id: group.product_id,
      product_name: group.product_name,
      product_code: group.product_code,
      qty: 0,
      row_count: 0,
      process_names: [],
    }
    product.qty += group.qty
    product.row_count += group.row_count
    // groups は数量の多い順に来るので、そのまま足せば工程名も数量の多い順になる
    if (!product.process_names.includes(group.process_name)) {
      product.process_names.push(group.process_name)
    }
    byProduct.set(group.product_id, product)
  }
  return [...byProduct.values()].sort((a, b) => b.qty - a.qty || a.product_id - b.product_id)
}

/** 未割当のまとめ1行のキー */
export function unallocatedGroupKey(
  group: Pick<UnallocatedGroup, "product_id" | "process_name" | "reason">,
): string {
  return JSON.stringify([group.product_id, group.process_name, group.reason])
}

/** 製品の表示名（品名＋図番） */
export function productLabel(
  group: Pick<UnallocatedGroup, "product_id" | "product_name" | "product_code">,
): string {
  const name = group.product_name ?? `製品 #${group.product_id}`
  return group.product_code ? `${name}（${group.product_code}）` : name
}

/** 計算時刻（タイムスタンプ）の表示 */
export function formatComputedAt(value: string): string {
  return format(new Date(value), "M/d HH:mm")
}
