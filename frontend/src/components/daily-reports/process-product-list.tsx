"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, ListPlus } from "lucide-react"
import { UnallocatedGroupRow } from "@/components/daily-report-coverage/unallocated-group-list"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  CATEGORY_META,
  productLabel,
  unallocatedGroupKey,
} from "@/lib/daily-report-coverage-utils"
import type { ProcessProductRow } from "@/lib/daily-report-worklist-utils"

/**
 * ② 製品の工程を日報に合わせる: 製品ごとの行（Issue #707）。工程ルートが無い製品は「工程を登録」、
 * 日報の工程が工程ルートに無い（日報で追わない工程に実績がある）製品は「工程を編集」で製品の工程ルートを開く。
 * 行を開くと工程名・理由ごとのまとめと、元の日報の行を確認できる。製品単位の比較の画面は #708
 */
export function ProcessProductList({
  rows,
  months,
  canOpenRouting,
  onEditRouting,
}: {
  rows: readonly ProcessProductRow[]
  months: number | null
  canOpenRouting: (productId: number) => boolean
  onEditRouting: (productId: number) => void
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
        <ProcessProductItem
          key={row.product_id}
          row={row}
          months={months}
          canOpenRouting={canOpenRouting(row.product_id)}
          onEditRouting={() => onEditRouting(row.product_id)}
        />
      ))}
    </ul>
  )
}

function ProcessProductItem({
  row,
  months,
  canOpenRouting,
  onEditRouting,
}: {
  row: ProcessProductRow
  months: number | null
  canOpenRouting: boolean
  onEditRouting: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const categories = [...new Set(row.groups.map((g) => g.category))]
  return (
    <li className="space-y-2 px-3 py-2.5" data-testid="process-product-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          className="flex min-w-[min(100%,16rem)] flex-1 items-start gap-1 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span className="min-w-0 space-y-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="break-all font-medium">{productLabel(row)}</span>
              {row.product_has_routings ? (
                categories.map((category) => (
                  <Badge key={category} variant="secondary">
                    {CATEGORY_META[category].label}
                  </Badge>
                ))
              ) : (
                <Badge variant="secondary">工程ルートなし</Badge>
              )}
            </span>
            <span className="block text-xs text-muted-foreground">
              日報の工程: {row.process_names.join("、")}
            </span>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-right text-sm tabular-nums">
            {row.qty.toLocaleString()}個
            <span className="block text-xs text-muted-foreground">
              {row.row_count.toLocaleString()}行
            </span>
          </span>
          <Button variant="outline" size="sm" disabled={!canOpenRouting} onClick={onEditRouting}>
            <ListPlus />
            {row.product_has_routings ? "工程を編集" : "工程を登録"}
          </Button>
        </div>
      </div>
      {expanded && (
        <ul className="divide-y rounded-md border bg-muted/30">
          {row.groups.map((group) => (
            <UnallocatedGroupRow key={unallocatedGroupKey(group)} group={group} months={months} />
          ))}
        </ul>
      )}
    </li>
  )
}
