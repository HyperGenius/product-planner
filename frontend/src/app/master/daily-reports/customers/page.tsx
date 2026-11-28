"use client"

import {
  UnregisteredCustomerGroups,
  UnresolvedCustomerGroups,
} from "@/components/daily-report-names/customer-raw-groups"
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
 * 日報の実績の前提: 日報の顧客先（Issue #707 / #703）
 * URL: /master/daily-reports/customers
 *
 * アプリに未登録の日報の顧客先ごとに、その顧客先の製品をまとめて出す（顧客を選ぶと製品は①へ移る）。
 * まとまりの数はハブのバナーの件数と一致する（`classifyDailyReportWorklist()` の `prerequisite.groups`）。
 * 顧客先が空欄・対象外にした顧客先の製品は、顧客を選べないので別のまとまりにする（#products）
 */
export default function DailyReportCustomersPage() {
  const { worklist, counts, names, coverage, computedAt } = useDailyReportWorklist()
  const canEdit = useCanEditDailyReportNames()
  const customerMeta = DAILY_REPORT_PREREQUISITE_META.customer
  const productMeta = DAILY_REPORT_PREREQUISITE_META.product
  const { unregistered, unresolved } = worklist.prerequisite.groups

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
          <UnregisteredCustomerGroups
            groups={unregistered}
            canEdit={canEdit}
            emptyMessage="アプリに未登録の顧客先はありません"
          />
          {unresolved.length > 0 && (
            <section id="products" aria-labelledby="prerequisite-products" className="space-y-2">
              <h2 id="prerequisite-products" className="text-base font-semibold">
                {productMeta.label}
                <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
                  {formatWorkCount(counts.prerequisiteProduct, productMeta.unit)}
                </span>
              </h2>
              <UnresolvedCustomerGroups groups={unresolved} canEdit={canEdit} />
            </section>
          )}
        </div>
      )}
    </DailyReportPageLayout>
  )
}
