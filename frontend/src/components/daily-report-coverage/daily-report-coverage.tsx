"use client"

import * as React from "react"
import { ProductRoutingsDialog } from "@/components/product-routings-dialog"
import { Button } from "@/components/ui/button"
import { useCoverageCard } from "@/hooks/use-coverage-card"
import { useDailyReportCoverage } from "@/hooks/use-daily-report-coverage"
import { useStockEstimates } from "@/hooks/use-daily-report-stock"
import { useProducts } from "@/hooks/use-products"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import {
  DEFAULT_PERIOD_MONTHS,
  PERIOD_OPTIONS,
  formatComputedAt,
  productsWithoutRoutings,
  sumProductsWithoutRoutings,
  type CategoryFilter,
  type CoverageCard,
} from "@/lib/daily-report-coverage-utils"
import { formatWorkDate } from "@/lib/daily-report-name-utils"
import { STOCK_LABEL, feedbackWithoutEstimates } from "@/lib/daily-report-stock-utils"
import { DAILY_REPORT_NAME_EDITOR_ROLES } from "@/types/member"
import { CoverageSummaryCard } from "./coverage-summary-card"
import { ProductsWithoutRoutings } from "./products-without-routings"
import { StockEstimates } from "./stock-estimates"
import { UnallocatedGroupList } from "./unallocated-group-list"
import { UnmatchedPanel } from "./unmatched-panel"

/** 詳細パネルの上辺の色（カードの色に合わせる） */
const PANEL_STRIPE: Record<CoverageCard, string> = {
  unallocated: "border-t-amber-400",
  unmatched: "border-t-slate-400",
  routing: "border-t-red-500",
  stock: "border-t-sky-500",
}

/**
 * 日報の照合状況の画面 (Issue #542 / #639)。
 * 日報の実績がどこまで受注の工程につながっているか（割り付け済み・未割当・未照合）を上に示し、
 * 関心事のカード（未割当・未照合・工程マスタ未登録・作り置き）を選ぶと、その詳細だけを下に出す。
 * 選択中のカードは URL のハッシュに持つ。
 */
export function DailyReportCoverage() {
  const [months, setMonths] = React.useState<number | null>(DEFAULT_PERIOD_MONTHS)
  const [filter, setFilter] = React.useState<CategoryFilter>("hearing")
  const [routingProductId, setRoutingProductId] = React.useState<number | null>(null)
  const [card, setCard] = useCoverageCard()

  const { data, isLoading, isError } = useDailyReportCoverage(months)
  const { data: products } = useProducts()
  const { data: stock } = useStockEstimates()
  const { data: member } = useCurrentMember()
  // 作り置きの指摘（#591）を書き込めるロールは別名辞書と同じ
  const canEditStock = member != null && DAILY_REPORT_NAME_EDITOR_ROLES.includes(member.role)
  const productById = React.useMemo(
    () => new Map((products ?? []).map((p) => [p.id, p])),
    [products],
  )
  const canOpenRouting = (productId: number) => productById.has(productId)
  const withoutRoutings = React.useMemo(() => productsWithoutRoutings(data?.groups ?? []), [data])
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
            info={{
              routing: sumProductsWithoutRoutings(withoutRoutings),
              stockCount: stock ? stock.items.length : null,
              unallocatedGroupCount: data.groups.length,
            }}
            selected={card}
            onSelect={setCard}
          />
          {/* 選択中のカード以外の情報は出さない */}
          <div id="coverage-panel" className={`space-y-3 border-t-4 pt-4 ${PANEL_STRIPE[card]}`}>
            {card === "unallocated" && (
              <UnallocatedGroupList
                key={`${filter}-${months}`}
                groups={data.groups}
                months={months}
                filter={filter}
                onFilterChange={setFilter}
                canOpenRouting={canOpenRouting}
                onEditRouting={setRoutingProductId}
              />
            )}
            {card === "unmatched" && <UnmatchedPanel summary={data.summary} />}
            {card === "routing" && (
              <ProductsWithoutRoutings
                products={withoutRoutings}
                canOpenRouting={canOpenRouting}
                onEditRouting={setRoutingProductId}
              />
            )}
            {card === "stock" && (
              <>
                <StockEstimates canEdit={canEditStock} />
                {stock &&
                  stock.items.length === 0 &&
                  feedbackWithoutEstimates(stock).length === 0 && (
                    <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
                      推定が出ている{STOCK_LABEL}はありません
                    </p>
                  )}
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            名寄せ・工程の変更・作り置きの指摘は、次の集計（10〜15分ごと）で反映されます。
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
