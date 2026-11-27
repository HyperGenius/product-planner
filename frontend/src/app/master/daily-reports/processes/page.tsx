"use client"

import * as React from "react"
import { UnmatchedNameList } from "@/components/daily-report-names/unmatched-name-list"
import {
  DailyReportPageLayout,
  ListStatus,
  PeriodFilter,
} from "@/components/daily-reports/daily-report-page-layout"
import { ProcessProductList } from "@/components/daily-reports/process-product-list"
import { ProductRoutingsDialog } from "@/components/product-routings-dialog"
import {
  useCanEditDailyReportNames,
  useDailyReportWorklist,
} from "@/hooks/use-daily-report-worklist"
import { useProducts } from "@/hooks/use-products"
import { DEFAULT_PERIOD_MONTHS } from "@/lib/daily-report-coverage-utils"
import {
  DAILY_REPORT_PROCESS_NAME_META,
  DAILY_REPORT_WORK_META,
} from "@/lib/daily-report-worklist-utils"
import { formatWorkCount } from "@/lib/work-count"

/**
 * 日報の実績の② 製品の工程を日報に合わせる（Issue #707）
 * URL: /master/daily-reports/processes
 *
 * 工程ルートが無い製品・日報の工程が工程ルートに無い製品（旧照合状況の「工程マスタ未登録」と未割当の「工程ルートに無い工程」）と、
 * 工程マスタに無い日報の工程名（旧名寄せの「工程」）。製品単位で工程を見比べる画面は #708。
 * 件数は製品の数で、`classifyDailyReportWorklist()` の②の製品の行と一致する
 */
export default function DailyReportProcessesPage() {
  const [months, setMonths] = React.useState<number | null>(DEFAULT_PERIOD_MONTHS)
  const [routingProductId, setRoutingProductId] = React.useState<number | null>(null)
  const { worklist, counts, names, coverage, computedAt } = useDailyReportWorklist(months)
  const canEdit = useCanEditDailyReportNames()
  const { data: products } = useProducts()
  const productById = React.useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  )
  const routingProduct =
    routingProductId === null ? null : (productById.get(routingProductId) ?? null)
  const meta = DAILY_REPORT_WORK_META.processes
  const nameMeta = DAILY_REPORT_PROCESS_NAME_META

  return (
    <DailyReportPageLayout
      title={`② ${meta.label}`}
      count={counts.processProducts}
      unit={meta.unit}
      computedAt={computedAt}
      isCoverageError={coverage.isError}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pb-4">
        <section aria-labelledby="process-products" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="process-products" className="text-base font-semibold">
              製品
              <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
                {formatWorkCount(counts.processProducts, meta.unit)}
              </span>
            </h2>
            <PeriodFilter months={months} onChange={setMonths} />
          </div>
          {coverage.isLoading || coverage.isError ? (
            <ListStatus isLoading={coverage.isLoading} isError={coverage.isError} />
          ) : (
            <ProcessProductList
              key={String(months)}
              rows={worklist.processes.products}
              months={months}
              canOpenRouting={(id) => productById.has(id)}
              onEditRouting={setRoutingProductId}
            />
          )}
        </section>

        <section aria-labelledby="process-names" className="space-y-2">
          <h2 id="process-names" className="text-base font-semibold">
            {nameMeta.label}
            <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
              {formatWorkCount(counts.processNames, nameMeta.unit)}
            </span>
          </h2>
          {names.isLoading || names.isError ? (
            <ListStatus isLoading={names.isLoading} isError={names.isError} />
          ) : (
            <UnmatchedNameList
              items={worklist.processes.names}
              kind="process"
              canEdit={canEdit}
              emptyMessage="工程マスタに無い日報の工程名はありません"
              scroll={false}
            />
          )}
        </section>
      </div>

      {/* 閉じている間に設備グループ等を取得しないよう、開くときだけ描画する */}
      {routingProduct !== null && (
        <ProductRoutingsDialog
          product={routingProduct}
          open
          onOpenChange={(open) => {
            if (!open) setRoutingProductId(null)
          }}
        />
      )}
    </DailyReportPageLayout>
  )
}
