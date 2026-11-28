import { STOCK_LABEL } from "@/lib/daily-report-stock-utils"
import type {
  DailyReportCoverage,
  UnallocatedCategory,
  UnallocatedGroup,
} from "@/types/daily-report-progress"
import type { ProductProcessMismatch, UnmatchedName } from "@/types/daily-report-names"
import type { StockEstimates } from "@/types/daily-report-stock"
import { groupProductsByCustomerRaw, type CustomerRawGroups } from "@/lib/daily-report-name-utils"

/**
 * 日報の実績（仮称）のハブの振り分け（Issue #707、Epic #701）。
 *
 * 日報の表記（`GET /daily-reports/unmatched-names`）と未割当の実績のまとめ（`GET /daily-reports/coverage` の `groups`）を
 * 「次に何をするか」で振り分ける。②の行は製品の工程ルートと日報の工程が合わない製品（`GET /daily-reports/product-processes`、#708）。どの表記・まとめも、前提・① 日報の製品をつなぐ・② 製品の工程を日報に合わせる・
 * ③ 受注の無い製造を確かめる・対象外の**どれか1か所にだけ**置く（送品の消し込みの #691 と同じ考え方）。
 *
 * ハブの件数と各ページの行は、必ず `classifyDailyReportWorklist()` の結果から出す（別々に数えない）。
 * 分類ルール表は docs/features/daily-report-hub.md
 */

// ---------------------------------------------------------------------------
// ページと URL
// ---------------------------------------------------------------------------

/** ハブ */
export const DAILY_REPORT_HUB_HREF = "/master/daily-reports"

/** ハブの名前（仮称。マスタのタブ・サイドバー・見出しで使う） */
export const DAILY_REPORT_HUB_TITLE = "日報の実績"

/** ハブから開くページ（`/master/daily-reports/<page>`） */
export const DAILY_REPORT_PAGES = [
  "customers",
  "products",
  "processes",
  "unordered",
  "stock",
  "aliases",
] as const
export type DailyReportPage = (typeof DAILY_REPORT_PAGES)[number]

export function dailyReportPageHref(page: DailyReportPage): string {
  return `${DAILY_REPORT_HUB_HREF}/${page}`
}

/**
 * 旧「日報の照合状況」（`/master/daily-report-coverage`）のハッシュ（#639 のカード）の移り先（ハッシュは外部入力）。
 * - `#unallocated`（未割当）→ ③。工程ルートに無い工程の実績は②にあるが、カードの既定の中身は③に近い
 * - `#routing`（工程マスタ未登録）→ ②
 * - `#stock`（作り置き）→ 作り置き
 * - `#unmatched`（未照合）・空・知らない値 → ハブ（未照合は前提・①・②に分かれたため）
 */
export function dailyReportHrefFromLegacyCoverageHash(hash: string): string {
  const value = hash.replace(/^#/, "")
  const page: DailyReportPage | null =
    value === "unallocated"
      ? "unordered"
      : value === "routing"
        ? "processes"
        : value === "stock"
          ? "stock"
          : null
  return page ? dailyReportPageHref(page) : DAILY_REPORT_HUB_HREF
}

// ---------------------------------------------------------------------------
// 行き先・見出し・単位（1か所に置く）
// ---------------------------------------------------------------------------

/** 振り分けの行き先 */
export type DailyReportPlacement = "prerequisite" | "products" | "processes" | "unordered" | "excluded"

/** 作業のキュー（依存関係の順に並べる） */
export type DailyReportWorkKind = Extract<DailyReportPlacement, "products" | "processes" | "unordered">

export const DAILY_REPORT_WORK_KINDS: readonly DailyReportWorkKind[] = [
  "products",
  "processes",
  "unordered",
]

export interface DailyReportWorkMeta {
  /** 見出し・ボタン（動詞で書く） */
  label: string
  /** 件数の単位 */
  unit: string
}

/**
 * 作業ごとの見出しと件数の単位。
 * - ① 日報の (顧客先, 商品名) の組が1行（製品の別名は顧客単位）
 * - ② 製品が1行
 * - ③ 今の照合状況の未割当と同じ (製品, 工程名, 理由) のまとまりが1行
 */
export const DAILY_REPORT_WORK_META: Record<DailyReportWorkKind, DailyReportWorkMeta> = {
  products: { label: "日報の製品をつなぐ", unit: "品名" },
  processes: { label: "製品の工程を日報に合わせる", unit: "製品" },
  unordered: { label: "受注の無い製造を確かめる", unit: "件" },
}

/** 前提の種類 */
export type DailyReportPrerequisiteKind = "customer" | "product"

/**
 * 前提の見出しと単位（Issue #703）。
 * - customer: アプリに未登録の日報の顧客先。その顧客先の製品は顧客先のまとまりの中に出し、別に数えない
 * - product: 顧客先が空欄・対象外の日報の製品（顧客を選べないので、対象外にだけできる）
 */
export const DAILY_REPORT_PREREQUISITE_META: Record<DailyReportPrerequisiteKind, DailyReportWorkMeta> = {
  customer: { label: "日報の顧客先", unit: "顧客先" },
  product: { label: "顧客先が空欄・対象外の日報の製品", unit: "品名" },
}

/** 前提のまとまりの中の製品の単位（顧客先の見出しに出す） */
export const DAILY_REPORT_PREREQUISITE_PRODUCT_UNIT = "品名"

/** 参考: 作り置き（推定）。推定は (製品, 工程) ごとに出るので、製品の数で数える */
export const DAILY_REPORT_STOCK_META: DailyReportWorkMeta = {
  label: `${STOCK_LABEL}（推定）`,
  unit: "製品",
}

/** 参考: 登録済みの対応付け・対象外（管理のためのページ） */
export const DAILY_REPORT_ALIASES_LABEL = "登録済みの対応付け・対象外"

// ---------------------------------------------------------------------------
// 振り分け
// ---------------------------------------------------------------------------

/**
 * 日報の表記の行き先。
 * - 顧客先: 前提（顧客先が決まらないと製品を結び付けられない）
 * - 製品: 顧客先が決まっていれば①、決まっていなければ前提
 * - 工程: ②（製品の比較の画面の右の「工程名に結び付かない表記」に出す。#708）
 * - 設備: 対象外（割り付けに使わない。#709 で設備マスタ側へ移す。それまでは登録済みの対応付けのページに置く）
 */
export function placeUnmatchedName(
  item: Pick<UnmatchedName, "kind" | "customer_id">,
): Extract<DailyReportPlacement, "prerequisite" | "products" | "processes" | "excluded"> {
  switch (item.kind) {
    case "customer":
      return "prerequisite"
    case "product":
      return item.customer_id === null ? "prerequisite" : "products"
    case "process":
      return "processes"
    case "equipment":
      return "excluded"
  }
}

/**
 * 未割当の分類の行き先。工程に関する未割当（製品の工程ルートに無い工程・日報で追わない工程の実績）は②
 * （製品の比較の画面の右だけの工程・日報で追わない工程の行に出る。#708）、
 * それ以外は今の分類のまま③に置く（どの理由を③に残すかは #706 で本番のデータを見てから決める）
 */
export const UNALLOCATED_CATEGORY_PLACEMENT: Record<
  UnallocatedCategory,
  Extract<DailyReportPlacement, "processes" | "unordered">
> = {
  untracked_process: "processes",
  no_routing_process: "processes",
  other_customer_order: "unordered",
  unapproved_order: "unordered",
  closed_order_only: "unordered",
  no_order: "unordered",
  before_order_date: "unordered",
  stocked: "unordered",
  exceeds_order_qty: "unordered",
  no_work_date: "unordered",
}

export interface DailyReportWorklistCounts {
  /** 表記の一覧が届いていない間は null。未登録の顧客先の数（前提のページのまとまりの数） */
  customer: number | null
  /** 顧客先が空欄・対象外の日報の製品の数（未登録の顧客先の製品は数えない） */
  prerequisiteProduct: number | null
  products: number | null
  /** 製品の工程の突き合わせが届いていない間は null */
  processProducts: number | null
  /** 照合状況が届いていない間は null */
  unordered: number | null
}

export interface DailyReportWorklist {
  prerequisite: {
    /** アプリに未登録の日報の顧客先 */
    customers: UnmatchedName[]
    /** 顧客先が決まっていない日報の製品 */
    products: UnmatchedName[]
    /** 上の2つを顧客先ごとにまとめたもの（前提のページの一覧。Issue #703） */
    groups: CustomerRawGroups
  }
  /** ① 日報の製品をつなぐ */
  products: UnmatchedName[]
  /**
   * ② 製品の工程を日報に合わせる。ページの行・件数は `products`（工程ルートと日報の工程が合わない製品）。
   * 工程の表記・工程に関する未割当は製品の比較の画面に含まれるので、別の行にしない（#708）
   */
  processes: {
    /** 工程ルートと日報の工程が合わない製品（合わない工程の明細の多い順） */
    products: ProductProcessMismatch[]
    /** 工程マスタに無い日報の工程の表記（製品の比較の右に出る） */
    names: UnmatchedName[]
    /** 工程に関する未割当のまとめ（製品の比較の右だけの工程・日報で追わない工程に出る） */
    unallocated: UnallocatedGroup[]
  }
  /** ③ 受注の無い製造を確かめる（数量の多い順） */
  unordered: UnallocatedGroup[]
  /** 対象外（日報の設備） */
  excluded: { names: UnmatchedName[] }
  counts: DailyReportWorklistCounts
}

export interface DailyReportWorklistSources {
  /** `GET /daily-reports/unmatched-names`（出現件数の多い順） */
  unmatchedNames?: readonly UnmatchedName[]
  /** `GET /daily-reports/coverage` */
  coverage?: DailyReportCoverage
  /** `GET /daily-reports/product-processes`（合わない工程の明細の多い順） */
  productProcesses?: readonly ProductProcessMismatch[]
}

/** 日報の表記と未割当のまとめを、分類ルール表どおりに振り分ける */
export function classifyDailyReportWorklist(
  sources: DailyReportWorklistSources,
): DailyReportWorklist {
  const worklist: DailyReportWorklist = {
    prerequisite: { customers: [], products: [], groups: { unregistered: [], unresolved: [] } },
    products: [],
    processes: { products: [], names: [], unallocated: [] },
    unordered: [],
    excluded: { names: [] },
    counts: {
      customer: null,
      prerequisiteProduct: null,
      products: null,
      processProducts: null,
      unordered: null,
    },
  }

  for (const item of sources.unmatchedNames ?? []) {
    switch (placeUnmatchedName(item)) {
      case "prerequisite":
        if (item.kind === "customer") worklist.prerequisite.customers.push(item)
        else worklist.prerequisite.products.push(item)
        break
      case "products":
        worklist.products.push(item)
        break
      case "processes":
        worklist.processes.names.push(item)
        break
      case "excluded":
        worklist.excluded.names.push(item)
        break
    }
  }

  worklist.prerequisite.groups = groupProductsByCustomerRaw(
    worklist.prerequisite.customers,
    worklist.prerequisite.products,
  )

  for (const group of sources.coverage?.groups ?? []) {
    if (UNALLOCATED_CATEGORY_PLACEMENT[group.category] === "processes") {
      worklist.processes.unallocated.push(group)
    } else {
      worklist.unordered.push(group)
    }
  }
  worklist.processes.products = [...(sources.productProcesses ?? [])]

  if (sources.unmatchedNames) {
    worklist.counts.customer = worklist.prerequisite.groups.unregistered.length
    worklist.counts.prerequisiteProduct = worklist.prerequisite.groups.unresolved.reduce(
      (sum, group) => sum + group.products.length,
      0,
    )
    worklist.counts.products = worklist.products.length
  }
  if (sources.productProcesses) {
    worklist.counts.processProducts = worklist.processes.products.length
  }
  if (sources.coverage) {
    worklist.counts.unordered = worklist.unordered.length
  }
  return worklist
}

/** 作り置きの推定の製品の数（参考の件数） */
export function countStockProducts(stock: Pick<StockEstimates, "items">): number {
  return new Set(stock.items.map((item) => item.product_id)).size
}
