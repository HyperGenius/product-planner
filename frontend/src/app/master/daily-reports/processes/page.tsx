"use client"

import * as React from "react"
import {
  DailyReportPageLayout,
  ListStatus,
  PeriodFilter,
} from "@/components/daily-reports/daily-report-page-layout"
import { ProductProcessList } from "@/components/daily-reports/product-process-list"
import { useDailyReportWorklist } from "@/hooks/use-daily-report-worklist"
import { DEFAULT_PERIOD_MONTHS } from "@/lib/daily-report-coverage-utils"
import { DAILY_REPORT_WORK_META } from "@/lib/daily-report-worklist-utils"

/**
 * 日報の実績の② 製品の工程を日報に合わせる（Issue #707 / #708）
 * URL: /master/daily-reports/processes
 *
 * 工程ルートと日報の工程が合わない製品（工程名に結び付かない日報の工程・工程ルートに無い工程・工程ルートが無い製品・
 * 日報で追わないのに実績がある工程）を、合わない工程の明細の多い順に並べる。製品を選ぶと左右の比較
 * （`/master/daily-reports/processes/[productId]`）を開く。旧名寄せの「工程」と照合状況の「工程マスタ未登録」の役割を引き継ぐ。
 * 件数は製品の数で、`classifyDailyReportWorklist()` の②の行と一致する
 */
export default function DailyReportProcessesPage() {
  const [months, setMonths] = React.useState<number | null>(DEFAULT_PERIOD_MONTHS)
  const { worklist, counts, productProcesses, coverage, computedAt } = useDailyReportWorklist(months)
  const meta = DAILY_REPORT_WORK_META.processes

  return (
    <DailyReportPageLayout
      title={`② ${meta.label}`}
      count={counts.processProducts}
      unit={meta.unit}
      computedAt={computedAt}
      isCoverageError={coverage.isError}
    >
      <div className="flex justify-end">
        <PeriodFilter months={months} onChange={setMonths} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        {productProcesses.isLoading || productProcesses.isError ? (
          <ListStatus isLoading={productProcesses.isLoading} isError={productProcesses.isError} />
        ) : (
          <ProductProcessList rows={worklist.processes.products} months={months} />
        )}
      </div>
    </DailyReportPageLayout>
  )
}
