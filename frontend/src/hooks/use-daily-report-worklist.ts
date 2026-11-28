"use client"

import { useMemo } from "react"
import { useDailyReportCoverage } from "@/hooks/use-daily-report-coverage"
import { useProductProcesses, useUnmatchedNames } from "@/hooks/use-daily-report-names"
import { useStockEstimates } from "@/hooks/use-daily-report-stock"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { DEFAULT_PERIOD_MONTHS } from "@/lib/daily-report-coverage-utils"
import {
  classifyDailyReportWorklist,
  countStockProducts,
} from "@/lib/daily-report-worklist-utils"
import type { WorkCount } from "@/lib/work-count"
import { DAILY_REPORT_NAME_EDITOR_ROLES } from "@/types/member"

export interface DailyReportWorkCounts {
  customer: WorkCount
  prerequisiteProduct: WorkCount
  products: WorkCount
  processProducts: WorkCount
  unordered: WorkCount
  stock: WorkCount
}

function workCount(value: number | null, isError: boolean): WorkCount {
  return { value: isError ? null : value, isError }
}

/**
 * 日報の実績のハブと各ページで共有するデータ（Issue #707）。件数も一覧の行も `classifyDailyReportWorklist()` の
 * 結果から出すので、ハブの件数とページの行数は一致する（同じクエリキーなのでハブからページへ移っても取り直さない）。
 *
 * `months` は②③（製品の工程の突き合わせ・未割当のまとめ）の加工日の期間。ハブは既定の期間（`DEFAULT_PERIOD_MONTHS`）で数え、
 * ②③のページで期間を変えるとそのページの件数と行が変わる
 */
export function useDailyReportWorklist(months: number | null = DEFAULT_PERIOD_MONTHS) {
  const names = useUnmatchedNames()
  const coverage = useDailyReportCoverage(months)
  const productProcesses = useProductProcesses(months)
  const stock = useStockEstimates()

  const worklist = useMemo(
    () =>
      classifyDailyReportWorklist({
        unmatchedNames: names.data,
        coverage: coverage.data,
        productProcesses: productProcesses.data,
      }),
    [names.data, coverage.data, productProcesses.data],
  )

  const counts: DailyReportWorkCounts = useMemo(
    () => ({
      customer: workCount(worklist.counts.customer, names.isError),
      prerequisiteProduct: workCount(worklist.counts.prerequisiteProduct, names.isError),
      products: workCount(worklist.counts.products, names.isError),
      processProducts: workCount(worklist.counts.processProducts, productProcesses.isError),
      unordered: workCount(worklist.counts.unordered, coverage.isError),
      stock: workCount(stock.data ? countStockProducts(stock.data) : null, stock.isError),
    }),
    [worklist, names.isError, coverage.isError, productProcesses.isError, stock.data, stock.isError],
  )

  return {
    worklist,
    counts,
    names,
    coverage,
    productProcesses,
    stock,
    /** 割り付けの最終計算日時（データの鮮度）。一度も計算していなければ null */
    computedAt: coverage.data?.computed_at ?? null,
  }
}

export type DailyReportWorklistState = ReturnType<typeof useDailyReportWorklist>

/**
 * 日報の表記の結び付け・作り置きの指摘を書き込めるか。ロール取得前は読み取り専用で表示する
 * （書き込みは API 側でもロールを確認する）
 */
export function useCanEditDailyReportNames(): boolean {
  const { data: member } = useCurrentMember()
  return member != null && DAILY_REPORT_NAME_EDITOR_ROLES.includes(member.role)
}
