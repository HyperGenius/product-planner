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
import { DAILY_REPORT_PREREQUISITE_META } from "@/lib/daily-report-worklist-utils"
import { formatWorkCount } from "@/lib/work-count"

/**
 * 日報の実績の前提: 日報の顧客先（Issue #707）
 * URL: /master/daily-reports/customers
 *
 * アプリに未登録の日報の顧客先と、顧客先が決まっていない日報の製品。顧客先ごとにまとめた一覧は #703。
 * 行は `classifyDailyReportWorklist()` の前提で、ハブのバナーの件数と一致する
 */
export default function DailyReportCustomersPage() {
  const { worklist, counts, names, coverage, computedAt } = useDailyReportWorklist()
  const canEdit = useCanEditDailyReportNames()
  const customerMeta = DAILY_REPORT_PREREQUISITE_META.customer
  const productMeta = DAILY_REPORT_PREREQUISITE_META.product

  return (
    <DailyReportPageLayout
      title={customerMeta.label}
      count={counts.customer}
      unit={customerMeta.unit}
      computedAt={computedAt}
      isCoverageError={coverage.isError}
    >
      {names.isLoading || names.isError ? (
        <ListStatus isLoading={names.isLoading} isError={names.isError} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
          <UnmatchedNameList
            items={worklist.prerequisite.customers}
            kind="customer"
            canEdit={canEdit}
            emptyMessage="アプリに未登録の顧客先はありません"
            scroll={false}
          />
          {worklist.prerequisite.products.length > 0 && (
            <section id="products" aria-labelledby="prerequisite-products" className="space-y-2">
              <h2 id="prerequisite-products" className="text-base font-semibold">
                {productMeta.label}
                <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
                  {formatWorkCount(counts.prerequisiteProduct, productMeta.unit)}
                </span>
              </h2>
              <UnmatchedNameList
                items={worklist.prerequisite.products}
                kind="product"
                canEdit={canEdit}
                emptyMessage=""
                scroll={false}
              />
            </section>
          )}
        </div>
      )}
    </DailyReportPageLayout>
  )
}
