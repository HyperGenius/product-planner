import { DEFAULT_PERIOD_MONTHS, PERIOD_OPTIONS } from "@/lib/daily-report-coverage-utils"
import { normalizeProcessName } from "@/lib/untracked-process-utils"
import { dailyReportPageHref } from "@/lib/daily-report-worklist-utils"
import type { ProductProcessComparison } from "@/types/daily-report-names"

/**
 * ② 製品の工程を日報に合わせる: 製品の工程ルート（左）と日報の工程（右）の比較（Issue #708）
 */

/** 期間「すべて」を URL に出すときの値 */
const ALL_PERIOD = "all"

/** 製品の比較の画面の URL。期間は一覧から持ち越す（既定の期間なら付けない） */
export function productProcessHref(productId: number, months: number | null): string {
  const base = `${dailyReportPageHref("processes")}/${productId}`
  if (months === DEFAULT_PERIOD_MONTHS) return base
  return `${base}?${new URLSearchParams({ months: months === null ? ALL_PERIOD : String(months) })}`
}

/** URL の期間（外部入力）。選べる期間に無い値は既定の期間にする */
export function parsePeriodParam(value: string | null): number | null {
  if (value === ALL_PERIOD) return null
  const months = Number(value)
  return PERIOD_OPTIONS.some((option) => option.months !== null && option.months === months)
    ? months
    : DEFAULT_PERIOD_MONTHS
}

/** URL の製品 ID（外部入力）。1以上の整数でなければ null */
export function parseProductIdParam(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

/** 工程名がすべて工程ルートにあるか（工程の別名・工程の追加の後に「揃ったか」を知らせる） */
export function allInRouting(
  processNames: readonly string[],
  routingNames: readonly (string | null | undefined)[],
): boolean {
  const names = new Set(routingNames.map(normalizeProcessName).filter(Boolean))
  return processNames.length > 0 && processNames.every((n) => names.has(normalizeProcessName(n)))
}

/** 比較の工程ルートの工程名 */
export function routingNamesOf(comparison: Pick<ProductProcessComparison, "routings">): string[] {
  return comparison.routings.map((row) => row.process_name)
}

/** 表記の明細の数を「12明細」の形で（単位は UI文言ガイドラインと揃える） */
export function formatEntryCount(count: number): string {
  return `${count.toLocaleString()}明細`
}
