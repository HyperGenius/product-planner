"use client"

import * as React from "react"
import { format } from "date-fns"
import { MessageSquareWarning } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useStockEstimates } from "@/hooks/use-daily-report-stock"
import { COVERAGE_LIST_SCROLL_CLASS, productLabel } from "@/lib/daily-report-coverage-utils"
import { formatWorkDate } from "@/lib/daily-report-name-utils"
import {
  STOCK_LABEL,
  feedbackSummary,
  feedbackWithoutEstimates,
  groupStockByConsumer,
  stockConsumedByLabel,
  stockPlaceLabel,
} from "@/lib/daily-report-stock-utils"
import type { StockFeedback } from "@/types/daily-report-stock"
import { StockFeedbackDialog, type StockFeedbackTarget } from "./stock-feedback-dialog"

/**
 * 日報からの作り置き（先行着手）の推定 (Issue #591)。
 * 正確な数は目指さず、推定を見せて違うところを「違う」で指摘してもらい、次の集計で直す。
 * ヒアリングで現場の人に画面を見せながら確認する想定で、推定数の多い順に並べる。
 */
export function StockEstimates({ canEdit }: { canEdit: boolean }) {
  const { data, isError } = useStockEstimates()
  const [target, setTarget] = React.useState<StockFeedbackTarget | null>(null)

  const feedbackByProduct = React.useMemo(
    () => new Map((data?.feedback ?? []).map((f) => [f.product_id, f])),
    [data],
  )

  if (isError) {
    return <p className="text-sm text-destructive">{STOCK_LABEL}の推定を取得できませんでした</p>
  }
  if (!data) return null
  const feedbackOnly = feedbackWithoutEstimates(data)
  if (data.items.length === 0 && feedbackOnly.length === 0) return null

  const feedbackButton = (
    product: { product_id: number; product_name: string | null; product_code: string | null },
    processName: string,
    label: string,
  ) => (
    <Button
      variant="outline"
      size="sm"
      disabled={!canEdit}
      aria-label={`${productLabel(product)}の${label}`}
      onClick={() =>
        setTarget({
          productId: product.product_id,
          productLabel: productLabel(product),
          processName,
        })
      }
    >
      <MessageSquareWarning />
      {label}
    </Button>
  )

  return (
    <section className="space-y-2" aria-labelledby="stock-estimates">
      <div>
        <h2 id="stock-estimates" className="text-lg font-semibold">
          {STOCK_LABEL}（推定）
          <Badge variant="secondary" className="ml-2 align-middle">
            {data.items.length}
          </Badge>
        </h2>
        <p className="text-sm text-muted-foreground">
          受注に割り付いていない、作っておいた品物の推定数です。現場の実態と違うところは「違う」で直してください（次の集計で反映されます）。
        </p>
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer text-primary">推定の見方</summary>
          日報からの推定で、正確な数は目指していません。工程ごとに、次の工程で使われたら減り、最後の工程なら送品で減るとみなしています。
        </details>
      </div>

      {data.items.length > 0 && (
        <div className={`space-y-3 ${COVERAGE_LIST_SCROLL_CLASS}`}>
          {groupStockByConsumer(data.items).map((group) => (
            <div key={group.nextProcessName ?? ""} className="rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-1.5 text-sm font-semibold">
                {stockConsumedByLabel({ next_process_name: group.nextProcessName })}
                <span className="font-normal text-muted-foreground">
                  {group.items.length.toLocaleString()} 製品
                </span>
              </div>
              <ul className="divide-y">
                {group.items.map((item) => {
                  const feedback = feedbackByProduct.get(item.product_id)
                  return (
                    <li
                      key={`${item.product_id}-${item.process_name}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2"
                    >
                      <div className="min-w-[min(100%,16rem)] flex-1 space-y-0.5">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="break-all font-medium">{productLabel(item)}</span>
                          <Badge variant="outline">{stockPlaceLabel(item)}</Badge>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          最後の動き {formatWorkDate(item.last_movement_date)}
                        </p>
                        {feedback && <FeedbackNote feedback={feedback} />}
                      </div>
                      <span className="text-sm tabular-nums">{item.qty.toLocaleString()} 個</span>
                      {feedbackButton(item, item.process_name, "違う")}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {feedbackOnly.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">指摘済みで推定を出していない製品</h3>
          <ul className="divide-y rounded-lg border bg-card">
            {feedbackOnly.map((feedback) => (
              <li
                key={feedback.product_id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5"
              >
                <div className="min-w-[min(100%,16rem)] flex-1 space-y-1">
                  <p className="break-all font-medium">{productLabel(feedback)}</p>
                  <FeedbackNote feedback={feedback} />
                </div>
                {feedbackButton(feedback, feedback.process_name ?? "", "指摘を直す")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <StockFeedbackDialog
        target={target}
        feedback={target ? feedbackByProduct.get(target.productId) : undefined}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
      />
    </section>
  )
}

function FeedbackNote({ feedback }: { feedback: StockFeedback }) {
  return (
    <p className="text-xs">
      <span className="font-medium">指摘: </span>
      {feedbackSummary(feedback)}
      {feedback.note && <span className="text-muted-foreground">（{feedback.note}）</span>}
      <span className="ml-1 text-muted-foreground">
        {format(new Date(feedback.updated_at), "yyyy/MM/dd")}
      </span>
    </p>
  )
}
