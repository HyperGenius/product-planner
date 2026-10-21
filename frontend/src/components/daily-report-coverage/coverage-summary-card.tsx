"use client"

import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  allocatedRatio,
  formatPercent,
  ratio,
} from "@/lib/daily-report-coverage-utils"
import type { CoverageSummary, UnallocatedCategory } from "@/types/daily-report-progress"

const SEGMENTS = [
  { key: "allocated", label: "受注に割り付け済み", color: "bg-emerald-500" },
  { key: "unallocated", label: "未割当（照合はできた）", color: "bg-amber-400" },
  { key: "unmatched", label: "未照合（マスタに無い表記）", color: "bg-slate-400" },
] as const

/**
 * 照合状況のサマリ (Issue #542)。日報の良品数を「割り付け済み / 未割当 / 未照合」に分けて出し、
 * 未割当は分類ごとの内訳を押すと下の一覧がその分類に絞り込まれる。
 */
export function CoverageSummaryCard({
  summary,
  onSelectCategory,
}: {
  summary: CoverageSummary
  onSelectCategory: (category: UnallocatedCategory) => void
}) {
  const values = {
    allocated: summary.allocated_qty,
    unallocated: summary.unallocated_qty,
    unmatched: summary.unmatched_qty,
  }
  const byCategory = new Map(summary.unallocated.map((t) => [t.category, t]))
  const categories = CATEGORY_ORDER.filter((c) => byCategory.has(c))

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm text-muted-foreground">受注に割り付けできた実績</p>
            <p className="text-4xl font-bold tabular-nums">
              {formatPercent(allocatedRatio(summary))}
            </p>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {summary.allocated_qty.toLocaleString()} / {summary.total_qty.toLocaleString()} 個
          </p>
        </div>

        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={SEGMENTS.map(
            (s) => `${s.label} ${formatPercent(ratio(values[s.key], summary.total_qty))}`,
          ).join("、")}
        >
          {SEGMENTS.map((s) => {
            const r = ratio(values[s.key], summary.total_qty)
            return r ? (
              <div key={s.key} className={s.color} style={{ width: `${r * 100}%` }} />
            ) : null
          })}
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          {SEGMENTS.map((s) => (
            <div key={s.key} className="space-y-0.5">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.color}`} />
                {s.label}
              </dt>
              <dd className="text-lg font-semibold tabular-nums">
                {values[s.key].toLocaleString()} 個
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                  {formatPercent(ratio(values[s.key], summary.total_qty))}
                </span>
              </dd>
              {s.key === "unmatched" && summary.unmatched_rows > 0 && (
                <dd>
                  <Link
                    href="/master/daily-report-names"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {summary.unmatched_rows.toLocaleString()} 行を名寄せで対応付ける
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </dd>
              )}
            </div>
          ))}
        </dl>

        {categories.length > 0 && (
          <div className="space-y-1.5 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground">未割当の内訳</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {categories.map((category) => {
                const total = byCategory.get(category)!
                const { label, needsHearing } = CATEGORY_META[category]
                return (
                  <li key={category}>
                    <button
                      type="button"
                      className="flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => onSelectCategory(category)}
                    >
                      <span className={needsHearing ? "" : "text-muted-foreground"}>{label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {total.qty.toLocaleString()}
                        </span>{" "}
                        個・{total.row_count.toLocaleString()} 行
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          数量は日報の良品数です。1行が2つの工程にまたがる表記（「カシメ、仕上げ加工」など）は工程ごとに数えます。
        </p>
      </CardContent>
    </Card>
  )
}
