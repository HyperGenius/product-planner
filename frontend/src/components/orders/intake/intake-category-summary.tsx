"use client"

import { cn } from "@/lib/utils"
import {
  INTAKE_CATEGORIES,
  INTAKE_CATEGORY_META,
  type IntakeCategory,
} from "@/lib/order-utils"

/** 区分の表（`IntakeCategorySection`）の要素 ID。件数カードからページ内リンクで移動する */
export function intakeSectionId(category: IntakeCategory): string {
  return `intake-${category}`
}

interface IntakeCategorySummaryProps {
  counts: Record<IntakeCategory, number>
}

/** 「起票の確認」の区分ごとの件数。押すとその区分の表へ移動する（Issue #555） */
export function IntakeCategorySummary({ counts }: IntakeCategorySummaryProps) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {INTAKE_CATEGORIES.map((category) => {
        const meta = INTAKE_CATEGORY_META[category]
        const count = counts[category]
        const content = (
          <>
            <p className="text-sm font-medium text-muted-foreground">{meta.label}</p>
            <p className={cn("text-2xl font-bold", count > 0 ? meta.countClass : "text-muted-foreground")}>
              {count}
              <span className="ml-1 text-sm font-normal">件</span>
            </p>
          </>
        )
        // 0件の区分は表を出さないので、移動先の無いリンクにしない
        return count > 0 ? (
          <a
            key={category}
            href={`#${intakeSectionId(category)}`}
            aria-label={`${meta.label} ${count}件`}
            className={cn(
              "rounded-lg border p-4 shadow-sm transition-colors hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              meta.cardClass
            )}
          >
            {content}
          </a>
        ) : (
          <div
            key={category}
            aria-label={`${meta.label} 0件`}
            className="rounded-lg border bg-card p-4"
          >
            {content}
          </div>
        )
      })}
    </div>
  )
}
