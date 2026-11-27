"use client"

import { StockEstimates } from "@/components/daily-report-coverage/stock-estimates"
import { DailyReportPageLayout } from "@/components/daily-reports/daily-report-page-layout"
import {
  useCanEditDailyReportNames,
  useDailyReportWorklist,
} from "@/hooks/use-daily-report-worklist"
import { DAILY_REPORT_STOCK_META } from "@/lib/daily-report-worklist-utils"

/**
 * 日報の実績の参考: 作り置き（推定）（Issue #591 / #707）
 * URL: /master/daily-reports/stock
 *
 * 件数は推定が出ている製品の数（`countStockProducts()`）で、ハブの参考と同じ
 */
export default function DailyReportStockPage() {
  const { counts, coverage, computedAt } = useDailyReportWorklist()
  const canEdit = useCanEditDailyReportNames()
  const meta = DAILY_REPORT_STOCK_META

  return (
    <DailyReportPageLayout
      title={meta.label}
      count={counts.stock}
      unit={meta.unit}
      computedAt={computedAt}
      isCoverageError={coverage.isError}
    >
      <StockEstimates canEdit={canEdit} />
    </DailyReportPageLayout>
  )
}
