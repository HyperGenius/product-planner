"use client"

import { UnmatchedNameList } from "@/components/daily-report-names/unmatched-name-list"
import {
  DailyReportPageLayout,
  ListStatus,
} from "@/components/daily-reports/daily-report-page-layout"
import {
  useCanEditDailyReportNames,
  useDailyReportWorklist,
} from "@/hooks/use-daily-report-worklist"
import { DAILY_REPORT_WORK_META } from "@/lib/daily-report-worklist-utils"

/**
 * 日報の実績の① 日報の製品をつなぐ（Issue #707）
 * URL: /master/daily-reports/products
 *
 * 顧客先が決まっていて、製品マスタに結び付いていない日報の製品（顧客先と商品名の組）。
 * 行の操作の作り直しは #704 / #705。行は `classifyDailyReportWorklist()` の①で、ハブの件数と一致する
 */
export default function DailyReportProductsPage() {
  const { worklist, counts, names, coverage, computedAt } = useDailyReportWorklist()
  const canEdit = useCanEditDailyReportNames()
  const meta = DAILY_REPORT_WORK_META.products

  return (
    <DailyReportPageLayout
      title={`① ${meta.label}`}
      count={counts.products}
      unit={meta.unit}
      computedAt={computedAt}
      isCoverageError={coverage.isError}
    >
      {names.isLoading || names.isError ? (
        <ListStatus isLoading={names.isLoading} isError={names.isError} />
      ) : (
        <UnmatchedNameList
          items={worklist.products}
          kind="product"
          canEdit={canEdit}
          emptyMessage="つなぐ日報の製品はありません"
        />
      )}
    </DailyReportPageLayout>
  )
}
