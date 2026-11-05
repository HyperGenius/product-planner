"use client"

import * as React from "react"
import { Info } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import {
  allocatedRatio,
  formatPercent,
  ratio,
  type CoverageCard,
} from "@/lib/daily-report-coverage-utils"
import type { CoverageSummary } from "@/types/daily-report-progress"

/** 3色バーの区分。カードの色・並び（未割当 → 未照合）はこれに合わせる */
const SEGMENTS = [
  { key: "allocated", label: "割り付け済み", color: "bg-emerald-500" },
  { key: "unallocated", label: "未割当", color: "bg-amber-400" },
  { key: "unmatched", label: "未照合", color: "bg-slate-400" },
] as const

export interface CoverageCardsInfo {
  /** 工程マスタ未登録の製品 */
  routing: { productCount: number; qty: number; rowCount: number }
  /** 作り置きの推定の製品数。取得前・失敗時は null */
  stockCount: number | null
  /** 未割当のまとめの件数 */
  unallocatedGroupCount: number
}

/**
 * 照合状況のサマリと、関心事のカード (Issue #542 / #639)。
 * 日報の良品数を「割り付け済み / 未割当 / 未照合」に分けて出し、
 * カードを選ぶと下に、その関心事の詳細だけを出す。
 */
export function CoverageSummaryCard({
  summary,
  info,
  selected,
  onSelect,
}: {
  summary: CoverageSummary
  info: CoverageCardsInfo
  selected: CoverageCard
  onSelect: (card: CoverageCard) => void
}) {
  const [noteOpen, setNoteOpen] = React.useState(false)
  const values = {
    allocated: summary.allocated_qty,
    unallocated: summary.unallocated_qty,
    unmatched: summary.unmatched_qty,
  }
  const share = (qty: number) => formatPercent(ratio(qty, summary.total_qty))

  const cards: {
    key: CoverageCard
    label: string
    badge?: { text: string; className: string }
    main: string
    sub: string
    /** 上辺の色（バーと同じ色） */
    stripe: string
    ring: string
  }[] = [
    {
      key: "unallocated",
      label: "未割当（照合はできた）",
      main: `${summary.unallocated_qty.toLocaleString()} 個`,
      sub: `${share(summary.unallocated_qty)}・${info.unallocatedGroupCount.toLocaleString()} 件`,
      stripe: "border-t-amber-400",
      ring: "ring-amber-400",
    },
    {
      key: "unmatched",
      label: "未照合（マスタに無い表記）",
      main: `${summary.unmatched_qty.toLocaleString()} 個`,
      sub: `${share(summary.unmatched_qty)}・${summary.unmatched_rows.toLocaleString()} 行`,
      stripe: "border-t-slate-400",
      ring: "ring-slate-400",
    },
    {
      key: "routing",
      label: "工程マスタ未登録",
      badge: { text: "要対応", className: "text-red-600 dark:text-red-400" },
      main: `${info.routing.productCount.toLocaleString()} 製品`,
      sub: `${info.routing.qty.toLocaleString()} 個・${info.routing.rowCount.toLocaleString()} 行が割り付け対象外`,
      stripe: "border-t-red-500",
      ring: "ring-red-500",
    },
    {
      key: "stock",
      label: "作り置き（推定）",
      badge: { text: "参考", className: "text-muted-foreground" },
      main: info.stockCount === null ? "－" : `${info.stockCount.toLocaleString()} 製品`,
      sub: "受注に割り付いていない在庫",
      stripe: "border-t-sky-500",
      ring: "ring-sky-500",
    },
  ]

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-sm text-muted-foreground">受注に割り付けできた実績</p>
            <p className="text-4xl font-bold tabular-nums">
              {formatPercent(allocatedRatio(summary))}
            </p>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {summary.allocated_qty.toLocaleString()} / {summary.total_qty.toLocaleString()} 個
            <button
              type="button"
              className="ml-1.5 inline-flex align-middle text-muted-foreground hover:text-foreground"
              aria-label="数量の数え方"
              aria-expanded={noteOpen}
              onClick={() => setNoteOpen((v) => !v)}
            >
              <Info className="h-4 w-4" />
            </button>
          </p>
        </div>
        {noteOpen && (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            数量は日報の良品数です。1行が2つの工程にまたがる表記（「カシメ、仕上げ加工」など）は工程ごとに数えます。
          </p>
        )}

        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={SEGMENTS.map((s) => `${s.label} ${share(values[s.key])}`).join("、")}
        >
          {SEGMENTS.map((s) => {
            const r = ratio(values[s.key], summary.total_qty)
            return r ? (
              <div key={s.key} className={s.color} style={{ width: `${r * 100}%` }} />
            ) : null
          })}
        </div>

        <div
          className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4"
          role="group"
          aria-label="確認する内容"
        >
          {cards.map((card) => {
            const isSelected = selected === card.key
            return (
              <button
                key={card.key}
                type="button"
                aria-pressed={isSelected}
                aria-controls="coverage-panel"
                className={`flex flex-col gap-0.5 rounded-lg border border-t-[5px] bg-card px-3 py-2.5 text-left hover:bg-accent ${card.stripe} ${
                  isSelected ? `bg-accent ring-2 ${card.ring}` : ""
                }`}
                onClick={() => onSelect(card.key)}
              >
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{card.label}</span>
                  {card.badge && (
                    <span className={`font-semibold ${card.badge.className}`}>
                      {card.badge.text}
                    </span>
                  )}
                </span>
                <span className="text-xl font-bold tabular-nums">{card.main}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{card.sub}</span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
