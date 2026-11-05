"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatPercent, ratio } from "@/lib/daily-report-coverage-utils"
import type { CoverageSummary } from "@/types/daily-report-progress"

/**
 * 未照合（マスタに無い表記）の詳細 (Issue #639)。
 * 表記の一覧と対応付けは名寄せの画面で行うので、ここでは件数と導線だけを出す。
 */
export function UnmatchedPanel({ summary }: { summary: CoverageSummary }) {
  return (
    <section className="space-y-2" aria-labelledby="unmatched-panel">
      <div>
        <h2 id="unmatched-panel" className="text-lg font-semibold">
          未照合の表記
        </h2>
        <p className="text-sm text-muted-foreground">
          日報の表記がマスタに無く、設備・工程・顧客・製品に結びつかなかった実績です。名寄せで対応付けると、次の集計から割り付けの対象になります。
        </p>
      </div>
      {summary.unmatched_rows === 0 ? (
        <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
          未照合の実績はありません
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
          <p className="text-sm tabular-nums">
            <span className="font-semibold">{summary.unmatched_rows.toLocaleString()} 行</span>・
            {summary.unmatched_qty.toLocaleString()} 個（
            {formatPercent(ratio(summary.unmatched_qty, summary.total_qty))}）
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/master/daily-report-names">
              名寄せで対応付ける
              <ArrowRight />
            </Link>
          </Button>
        </div>
      )}
    </section>
  )
}
