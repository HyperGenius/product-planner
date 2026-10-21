"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, ListPlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  matchesCategoryFilter,
  productLabel,
  unallocatedGroupKey,
  type CategoryFilter,
} from "@/lib/daily-report-coverage-utils"
import { formatWorkDate } from "@/lib/daily-report-name-utils"
import type { UnallocatedGroup } from "@/types/daily-report-progress"
import { UnallocatedActualsTable } from "./unallocated-actuals-table"

/** 一度に描画する行数。残りは「さらに表示」で出す */
const PAGE_SIZE = 50

/**
 * 未割当の実績の (製品, 工程名, 理由) ごとのまとめ (Issue #542)。数量の多い順に、
 * 現場にそのまま聞ける問いかけを添えて並べる。行を開くと元の日報の行を確認できる。
 * 表示件数は絞り込み・期間を変えたら戻したいので、呼び出し側でそれらを `key` に入れる。
 */
export function UnallocatedGroupList({
  groups,
  months,
  filter,
  onFilterChange,
  canOpenRouting,
  onEditRouting,
}: {
  groups: UnallocatedGroup[]
  months: number | null
  filter: CategoryFilter
  onFilterChange: (filter: CategoryFilter) => void
  canOpenRouting: (productId: number) => boolean
  onEditRouting: (productId: number) => void
}) {
  const [visible, setVisible] = React.useState(PAGE_SIZE)

  const filtered = groups.filter((g) => matchesCategoryFilter(g, filter))
  const presentCategories = CATEGORY_ORDER.filter((c) => groups.some((g) => g.category === c))
  const options: { value: CategoryFilter; label: string; count: number }[] = [
    {
      value: "hearing",
      label: "要確認",
      count: groups.filter((g) => matchesCategoryFilter(g, "hearing")).length,
    },
    ...presentCategories.map((c) => ({
      value: c,
      label: CATEGORY_META[c].label,
      count: groups.filter((g) => g.category === c).length,
    })),
    { value: "all", label: "すべて", count: groups.length },
  ]

  return (
    <section className="space-y-2" aria-labelledby="unallocated-groups">
      <div>
        <h2 id="unallocated-groups" className="text-lg font-semibold">
          割り付けできなかった実績
        </h2>
        <p className="text-sm text-muted-foreground">
          製品・工程・理由ごとに、数量の多い順に並べています。上から順に現場で確認すると、少ない手間で割り付けできる実績が増えます。
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="理由で絞り込む">
        {options.map((option) => (
          <Button
            key={option.value}
            variant={filter === option.value ? "default" : "outline"}
            size="sm"
            aria-pressed={filter === option.value}
            onClick={() => onFilterChange(option.value)}
          >
            {option.label}
            <span className="tabular-nums opacity-70">{option.count}</span>
          </Button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border bg-card py-8 text-center text-sm text-muted-foreground">
          {groups.length === 0 ? "割り付けできなかった実績はありません" : "該当する実績はありません"}
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-lg border bg-card">
            {filtered.slice(0, visible).map((group) => (
              <UnallocatedGroupRow
                key={unallocatedGroupKey(group)}
                group={group}
                months={months}
                canOpenRouting={canOpenRouting(group.product_id)}
                onEditRouting={() => onEditRouting(group.product_id)}
              />
            ))}
          </ul>
          {filtered.length > visible && (
            <div className="text-center">
              <Button variant="ghost" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                さらに表示（残り {filtered.length - visible} 件）
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function formatRange(group: UnallocatedGroup): string {
  const { first_work_date: first, last_work_date: last } = group
  if (!first || !last) return "加工日なし"
  return first === last
    ? formatWorkDate(first)
    : `${formatWorkDate(first)} 〜 ${formatWorkDate(last)}`
}

function UnallocatedGroupRow({
  group,
  months,
  canOpenRouting,
  onEditRouting,
}: {
  group: UnallocatedGroup
  months: number | null
  canOpenRouting: boolean
  onEditRouting: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const meta = CATEGORY_META[group.category]

  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
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
              <span className="break-all font-medium">{productLabel(group)}</span>
              <Badge variant="outline">{group.process_name}</Badge>
              <Badge variant={meta.needsHearing ? "secondary" : "outline"}>{meta.label}</Badge>
            </span>
            <span
              className={`block text-sm ${meta.needsHearing ? "" : "text-muted-foreground"}`}
            >
              {meta.question(group)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {formatRange(group)}
              {group.customer_names.length > 0 && `・${group.customer_names.join("、")}`}
            </span>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-right text-sm tabular-nums">
            {group.qty.toLocaleString()} 個
            <span className="block text-xs text-muted-foreground">
              {group.row_count.toLocaleString()} 行
            </span>
          </span>
          {group.category === "no_routing_process" && (
            <Button
              variant="outline"
              size="sm"
              disabled={!canOpenRouting}
              onClick={onEditRouting}
            >
              <ListPlus />
              工程を編集
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="rounded-md border bg-muted/30">
          <UnallocatedActualsTable group={group} months={months} />
        </div>
      )}
    </li>
  )
}
