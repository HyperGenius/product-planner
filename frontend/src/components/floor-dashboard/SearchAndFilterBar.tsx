"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { STATUS_CLASS } from "@/components/floor-dashboard/DeadlineBadge"
import type { OrderSearchFilters } from "@/lib/floor-dashboard-utils"
import type { DeadlineStatus } from "@/lib/floor-dashboard-utils"

const LEGEND_ITEMS: { status: DeadlineStatus; label: string }[] = [
  { status: "overdue", label: "納期超過" },
  { status: "due_soon", label: "1週間未満" },
  { status: "on_track", label: "1週間以上" },
]

/**
 * `STATUS_CLASS` の値（複数のTailwindクラスを含む文字列）から `bg-` クラスのみを抽出する。
 * クラスの並び順に依存すると `STATUS_CLASS` の並び替えで凡例の色が壊れるため（Copilotレビュー指摘, PR #449）、
 * 順序に依存しない形で `bg-` クラスを検索する。
 */
function extractBgClass(classNames: string): string {
  return classNames.split(" ").find((c) => c.startsWith("bg-")) ?? ""
}

interface SearchAndFilterBarProps {
  filters: OrderSearchFilters
  onFiltersChange: (filters: OrderSearchFilters) => void
}

/**
 * 現場ダッシュボードの検索・フィルタバー（Issue #444）。
 * 顧客名・製品名・注文番号のフリーテキスト検索、「納期遅れのみ」トグル、納期状態の色分け凡例を提供する。
 * 凡例の色は `DeadlineBadge` の `STATUS_CLASS` をそのまま使い、バッジの実際の色とズレないようにする。
 */
export function SearchAndFilterBar({ filters, onFiltersChange }: SearchAndFilterBarProps) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          type="search"
          placeholder="顧客名・製品名・注文番号で検索"
          value={filters.searchText}
          onChange={(e) => onFiltersChange({ ...filters, searchText: e.target.value })}
          className="max-w-xs"
          aria-label="顧客名・製品名・注文番号で検索"
        />

        <div className="flex items-center gap-2">
          <Switch
            id="overdue-only-filter"
            checked={filters.overdueOnly}
            onCheckedChange={(checked) => onFiltersChange({ ...filters, overdueOnly: checked })}
          />
          <Label htmlFor="overdue-only-filter">納期遅れのみ</Label>
        </div>

        <div className="ml-auto flex items-center gap-4">
          {LEGEND_ITEMS.map(({ status, label }) => (
            <div key={status} className="flex items-center gap-1.5">
              <span
                className={`inline-block h-3 w-3 rounded-sm ${extractBgClass(STATUS_CLASS[status])}`}
                aria-hidden="true"
              />
              <span className="text-sm text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
