"use client"

import * as React from "react"
import { UnallocatedGroupList } from "@/components/daily-report-coverage/unallocated-group-list"
import {
  DailyReportPageLayout,
  ListStatus,
  PeriodFilter,
} from "@/components/daily-reports/daily-report-page-layout"
import { useDailyReportWorklist } from "@/hooks/use-daily-report-worklist"
import { DEFAULT_PERIOD_MONTHS, type CategoryFilter } from "@/lib/daily-report-coverage-utils"
import { DAILY_REPORT_WORK_META } from "@/lib/daily-report-worklist-utils"

/**
 * 日報の実績の③ 受注の無い製造を確かめる（Issue #707）
 * URL: /master/daily-reports/unordered
 *
 * 旧照合状況の「未割当」を今の分類のまま置く（工程に関する未割当は②）。どの理由を残すかは #706 で決める。
 * 件数は (製品, 工程名, 理由) のまとまりの数で、絞り込みの「すべて」（既定）の行数と一致する
 */
export default function DailyReportUnorderedPage() {
  const [months, setMonths] = React.useState<number | null>(DEFAULT_PERIOD_MONTHS)
  const [filter, setFilter] = React.useState<CategoryFilter>("all")
  const { worklist, counts, coverage, computedAt } = useDailyReportWorklist(months)
  const meta = DAILY_REPORT_WORK_META.unordered

  return (
    <DailyReportPageLayout
      title={`③ ${meta.label}`}
      count={counts.unordered}
      unit={meta.unit}
      computedAt={computedAt}
      isCoverageError={coverage.isError}
    >
      <PeriodFilter months={months} onChange={setMonths} />
      {coverage.isLoading || coverage.isError ? (
        <ListStatus isLoading={coverage.isLoading} isError={coverage.isError} />
      ) : (
        <UnallocatedGroupList
          key={`${filter}-${months}`}
          groups={worklist.unordered}
          months={months}
          filter={filter}
          onFilterChange={setFilter}
        />
      )}
    </DailyReportPageLayout>
  )
}
