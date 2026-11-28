"use client"

import type { CSSProperties } from "react"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { NAME_KIND_LABELS, NAME_KINDS, type NameKind } from "@/types/daily-report-names"

/**
 * 種別ごとの色 (Issue #643)。照合状況ページの意味色（未割当=amber・未照合=slate・要対応=red・参考=sky）とは
 * 役割が違うので、種別の識別にだけ使う。選択中の種別の色は一覧の上辺にも引く。
 */
export const KIND_COLORS: Record<NameKind, string> = {
  equipment: "#0ea5e9",
  process: "#8b5cf6",
  customer: "#10b981",
  product: "#f59e0b",
}

/** 種別の色を CSS 変数 `--kind-color` で渡す */
export function kindColorStyle(kind: NameKind): CSSProperties {
  return { "--kind-color": KIND_COLORS[kind] } as CSSProperties
}

/** 行リストのスクロール領域。選択中の種別の色が上辺に出る（`kindColorStyle` と併用） */
export const KIND_PANEL_CLASS =
  "min-h-0 flex-1 overflow-y-auto rounded-lg border border-t-4 border-t-[var(--kind-color)] bg-card"

/** スクロールをページ側に任せる行リスト（1ページに一覧を2つ並べるとき。Issue #707） */
export const KIND_LIST_CLASS = "rounded-lg border border-t-4 border-t-[var(--kind-color)] bg-card"

/**
 * 種別（設備・工程・顧客・製品）を選ぶカード型のタブ。
 * 外側の作業モードのタブ（下線）と見分けがつくよう、色付きの上辺を持たせる。
 * 件数は出さない（作業の件数は日報の実績のハブに単位付きで出す。Issue #707 / #702）。
 * `Tabs` の中に置く（`role="tab"` は維持）。
 */
export function KindTabsList({ className }: { className?: string }) {
  return (
    <TabsList
      variant="line"
      className={cn("grid h-auto w-full grid-cols-2 gap-2 p-0 sm:grid-cols-4", className)}
    >
      {NAME_KINDS.map((k) => (
        <TabsTrigger
          key={k}
          value={k}
          style={kindColorStyle(k)}
          className={cn(
            "h-auto flex-none justify-between rounded-lg border border-t-[5px] border-border border-t-[var(--kind-color)] bg-card px-3 py-1.5 hover:bg-accent",
            "data-[state=active]:border-border data-[state=active]:border-t-[var(--kind-color)] data-[state=active]:bg-accent data-[state=active]:ring-2 data-[state=active]:ring-[var(--kind-color)]",
            "after:hidden",
          )}
        >
          <span className="text-xs">{NAME_KIND_LABELS[k]}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
