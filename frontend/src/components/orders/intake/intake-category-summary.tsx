"use client"

import { cn } from "@/lib/utils"
import {
  INTAKE_CATEGORIES,
  INTAKE_CATEGORY_META,
  summarizeIntakeCategory,
  type IntakeCategory,
} from "@/lib/order-utils"
import type { Order } from "@/types/order"

/** 選択中の区分の一覧（`IntakeCategorySection`）の要素 ID。カードの `aria-controls` に使う */
export const INTAKE_PANEL_ID = "intake-panel"

/**
 * 色の意味は「受注担当の番」と「他の人の作業待ち」の2つだけ（Issue #654）。
 * 一覧の上辺（`IntakeCategorySection`）も同じ色にする
 */
export const INTAKE_OWNER_STYLE = {
  self: { stripe: "border-t-blue-500", ring: "ring-blue-500" },
  waiting: { stripe: "border-t-slate-300", ring: "ring-slate-400" },
} as const

export function intakeOwnerStyle(category: IntakeCategory) {
  return INTAKE_CATEGORY_META[category].waiting ? INTAKE_OWNER_STYLE.waiting : INTAKE_OWNER_STYLE.self
}

interface IntakeCategorySummaryProps {
  ordersByCategory: Record<IntakeCategory, Order[]>
  selected: IntakeCategory
  onSelect: (category: IntakeCategory) => void
}

/**
 * 「起票の確認」の区分のカード（Issue #555 / #654）。押すと下にその区分の一覧だけを出す。
 * 差し戻しは0件なら出さない。他の人の作業待ちのカードは区切り線の後ろに置く
 */
export function IntakeCategorySummary({
  ordersByCategory,
  selected,
  onSelect,
}: IntakeCategorySummaryProps) {
  const visible = INTAKE_CATEGORIES.filter(
    (category) => category !== "rejected" || ordersByCategory.rejected.length > 0
  )
  const own = visible.filter((category) => !INTAKE_CATEGORY_META[category].waiting)
  const waiting = visible.filter((category) => INTAKE_CATEGORY_META[category].waiting)

  const renderCard = (category: IntakeCategory) => {
    const meta = INTAKE_CATEGORY_META[category]
    const orders = ordersByCategory[category]
    const style = intakeOwnerStyle(category)
    const summary = summarizeIntakeCategory(category, orders)
    const isSelected = selected === category
    return (
      <button
        key={category}
        type="button"
        aria-pressed={isSelected}
        aria-controls={INTAKE_PANEL_ID}
        aria-label={`${meta.label} ${orders.length}件`}
        className={cn(
          "flex min-w-[11rem] flex-1 flex-col gap-0.5 rounded-lg border border-t-[5px] bg-card px-3 py-2.5 text-left hover:bg-accent",
          style.stripe,
          isSelected && `bg-accent ring-2 ${style.ring}`
        )}
        onClick={() => onSelect(category)}
      >
        <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{meta.label}</span>
          {meta.waiting && <span className="text-xs">待ち</span>}
        </span>
        <span
          className={cn(
            "text-2xl font-bold tabular-nums",
            (orders.length === 0 || meta.waiting) && "text-muted-foreground"
          )}
        >
          {orders.length}
          <span className="ml-1 text-sm font-normal">件</span>
        </span>
        <span
          className={cn(
            "text-xs",
            summary?.isAlert ? "font-semibold text-destructive" : "text-muted-foreground"
          )}
        >
          {summary?.text ?? meta.hint}
        </span>
      </button>
    )
  }

  return (
    <div className="mb-4 flex flex-wrap items-stretch gap-2.5" role="group" aria-label="確認する内容">
      {own.map(renderCard)}
      {waiting.length > 0 && (
        <>
          <div className="hidden w-px self-stretch bg-border sm:block" aria-hidden />
          {waiting.map(renderCard)}
        </>
      )}
    </div>
  )
}
