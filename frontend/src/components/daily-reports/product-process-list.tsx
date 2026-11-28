"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { productLabel } from "@/lib/daily-report-coverage-utils"
import { formatEntryCount, productProcessHref } from "@/lib/product-process-utils"
import type { ProductProcessMismatch } from "@/types/daily-report-names"

/**
 * ② 製品の工程を日報に合わせる: 工程ルートと日報の工程が合わない製品の一覧（Issue #708）。
 * 行を選ぶと製品の比較の画面（`/master/daily-reports/processes/[productId]`）を開く。
 * 並びは API のまま（合わない工程の明細の多い順）
 */
export function ProductProcessList({
  rows,
  months,
}: {
  rows: readonly ProductProcessMismatch[]
  months: number | null
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
        工程を合わせる製品はありません
      </p>
    )
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {rows.map((row) => (
        <li key={row.product_id}>
          <Link
            href={productProcessHref(row.product_id, months)}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent"
            data-testid="product-process-row"
          >
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-all font-medium">{productLabel(row)}</span>
              {!row.has_routings && <Badge variant="secondary">工程ルートなし</Badge>}
            </span>
            <span className="shrink-0 text-right text-sm tabular-nums">
              合わない工程 {row.mismatch_count}
              <span className="block text-xs text-muted-foreground">
                {formatEntryCount(row.entry_count)}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
