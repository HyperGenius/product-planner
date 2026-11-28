"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { ListPageLayout } from "@/components/layout/list-page-layout"
import { DailyReportHelp } from "@/components/daily-reports/daily-report-help"
import {
  DailyReportFreshness,
  ListStatus,
  PeriodFilter,
} from "@/components/daily-reports/daily-report-page-layout"
import { ProductProcessComparisonPanel } from "@/components/daily-reports/product-process-comparison"
import { useDailyReportCoverage } from "@/hooks/use-daily-report-coverage"
import { useProductProcessComparison } from "@/hooks/use-daily-report-names"
import { useCanEditDailyReportNames } from "@/hooks/use-daily-report-worklist"
import { productLabel } from "@/lib/daily-report-coverage-utils"
import { dailyReportPageHref, DAILY_REPORT_WORK_META } from "@/lib/daily-report-worklist-utils"
import {
  parsePeriodParam,
  parseProductIdParam,
  productProcessHref,
} from "@/lib/product-process-utils"

/**
 * ② 製品の工程を日報に合わせる: 製品1つの工程ルート（左）と日報の工程（右）の比較（Issue #708）
 * URL: /master/daily-reports/processes/[productId]（`?months=` は一覧から持ち越す加工日の期間。外部入力なので検証する）
 */
export default function DailyReportProductProcessPage() {
  const params = useParams<{ productId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const productId = parseProductIdParam(params?.productId)
  const months = parsePeriodParam(searchParams.get("months"))
  const comparison = useProductProcessComparison(productId, months)
  // データの鮮度（日報の集計の日時）はハブと同じ照合状況から出す
  const coverage = useDailyReportCoverage(months)
  const canEditNames = useCanEditDailyReportNames()

  const title =
    comparison.data !== undefined ? productLabel(comparison.data) : productId === null ? "製品" : ""

  return (
    <ListPageLayout
      back={
        <Link
          href={dailyReportPageHref("processes")}
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {DAILY_REPORT_WORK_META.processes.label}
        </Link>
      }
      title={title}
      help={<DailyReportHelp />}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DailyReportFreshness
          computedAt={coverage.data?.computed_at ?? null}
          isError={coverage.isError}
        />
        {productId !== null && (
          <PeriodFilter
            months={months}
            onChange={(next) => router.replace(productProcessHref(productId, next))}
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        {productId === null ? (
          <ListStatus isLoading={false} isError />
        ) : (
          <ProductProcessComparisonPanel
            comparison={comparison.data}
            isLoading={comparison.isLoading}
            isError={comparison.isError}
            canEditNames={canEditNames}
          />
        )}
      </div>
    </ListPageLayout>
  )
}
