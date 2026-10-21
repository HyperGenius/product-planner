"use client"

import * as React from "react"
import { ProductRoutingsDialog } from "@/components/product-routings-dialog"
import { Button } from "@/components/ui/button"
import { useDailyReportCoverage } from "@/hooks/use-daily-report-coverage"
import { useProducts } from "@/hooks/use-products"
import {
  DEFAULT_PERIOD_MONTHS,
  PERIOD_OPTIONS,
  formatComputedAt,
  productsWithoutRoutings,
  type CategoryFilter,
} from "@/lib/daily-report-coverage-utils"
import { formatWorkDate } from "@/lib/daily-report-name-utils"
import { CoverageSummaryCard } from "./coverage-summary-card"
import { ProductsWithoutRoutings } from "./products-without-routings"
import { UnallocatedGroupList } from "./unallocated-group-list"

/**
 * 日報の照合状況の画面 (Issue #542)。
 * 日報の実績がどこまで受注の工程につながっているか（割り付け済み・未割当・未照合）と、
 * つながっていない実績を製品・工程・理由ごとに出し、現場ヒアリングの項目として使う。
 */
export function DailyReportCoverage() {
  const [months, setMonths] = React.useState<number | null>(DEFAULT_PERIOD_MONTHS)
  const [filter, setFilter] = React.useState<CategoryFilter>("hearing")
  const [routingProductId, setRoutingProductId] = React.useState<number | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const { data, isLoading, isError } = useDailyReportCoverage(months)
  const { data: products } = useProducts()
  const productById = React.useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  )
  const canOpenRouting = (productId: number) => productById.has(productId)
  const routingProduct =
    routingProductId === null ? null : (productById.get(routingProductId) ?? null)

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">日報の照合状況</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            日報の実績が受注の工程にどこまでつながっているかと、つながっていない実績を確認します。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="加工日の期間">
            {PERIOD_OPTIONS.map((option) => (
              <Button
                key={option.label}
                variant={months === option.months ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={months === option.months}
                onClick={() => setMonths(option.months)}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {data?.computed_at && (
            <p className="text-xs text-muted-foreground">
              {formatComputedAt(data.computed_at)} 時点の集計
              {data.since && `（加工日 ${formatWorkDate(data.since)} 以降）`}
            </p>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="py-6 text-sm text-muted-foreground">読み込み中...</p>
      ) : isError || !data ? (
        <p className="py-6 text-sm text-destructive">照合状況を取得できませんでした</p>
      ) : data.computed_at === null ? (
        <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
          まだ集計されていません。日報の取り込み後、10〜15分ごとに集計されます。
        </p>
      ) : (
        <>
          <CoverageSummaryCard
            summary={data.summary}
            onSelectCategory={(category) => {
              setFilter(category)
              listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
            }}
          />
          <ProductsWithoutRoutings
            products={productsWithoutRoutings(data.groups)}
            canOpenRouting={canOpenRouting}
            onEditRouting={setRoutingProductId}
          />
          <div ref={listRef} className="scroll-mt-4">
            <UnallocatedGroupList
              key={`${filter}-${months}`}
              groups={data.groups}
              months={months}
              filter={filter}
              onFilterChange={setFilter}
              canOpenRouting={canOpenRouting}
              onEditRouting={setRoutingProductId}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            名寄せ・工程の変更は、次の集計（10〜15分ごと）で反映されます。
          </p>
        </>
      )}

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
    </div>
  )
}
