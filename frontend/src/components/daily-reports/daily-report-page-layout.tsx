"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { ListPageLayout } from "@/components/layout/list-page-layout"
import { Button } from "@/components/ui/button"
import { PERIOD_OPTIONS } from "@/lib/daily-report-coverage-utils"
import { DAILY_REPORT_HUB_HREF, DAILY_REPORT_HUB_TITLE } from "@/lib/daily-report-worklist-utils"
import { formatDateTimeShort } from "@/lib/order-utils"
import { cn } from "@/lib/utils"
import { formatWorkCount, type WorkCount } from "@/lib/work-count"
import { DailyReportHelp } from "./daily-report-help"

interface DailyReportPageLayoutProps {
  /** 見出し（「① 日報の製品をつなぐ」） */
  title: string
  /** 見出しの横の件数。管理のためのページ（登録済みの対応付け）では出さない */
  count?: WorkCount
  unit?: string
  /** データの鮮度（`useDailyReportWorklist()` の `computedAt` と照合状況の取得エラー） */
  computedAt: string | null
  isCoverageError: boolean
  children: ReactNode
}

/**
 * 日報の実績のハブから開くページの外枠（Issue #707）。ハブへ戻るリンク・件数付きの見出し・
 * 見出しの横のヘルプ（ハブと共有の `DailyReportHelp`）・データの鮮度を置き、一覧は残りの高さでスクロールさせる。
 * 件数はハブと同じ値（`useDailyReportWorklist().counts`）を渡し、一覧の行数と一致させる
 */
export function DailyReportPageLayout({
  title,
  count,
  unit,
  computedAt,
  isCoverageError,
  children,
}: DailyReportPageLayoutProps) {
  return (
    <ListPageLayout
      back={
        <Link
          href={DAILY_REPORT_HUB_HREF}
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {DAILY_REPORT_HUB_TITLE}
        </Link>
      }
      title={
        <>
          {title}
          {count && unit && (
            <span
              className={cn(
                "ml-3 text-lg font-normal tabular-nums text-muted-foreground",
                count.isError && "text-base text-red-600",
              )}
            >
              {formatWorkCount(count, unit)}
            </span>
          )}
        </>
      }
      help={<DailyReportHelp />}
    >
      <DailyReportFreshness computedAt={computedAt} isError={isCoverageError} />
      {children}
    </ListPageLayout>
  )
}

/**
 * データの鮮度（docs/ui-writing-guidelines.md 4.7）。日報の集計がどこまでかを1行に出し、
 * 取得に失敗したときだけ目立たせる
 */
export function DailyReportFreshness({
  computedAt,
  isError,
}: {
  computedAt: string | null
  isError: boolean
}) {
  return (
    <p className={cn("text-xs text-muted-foreground", isError && "font-medium text-red-600")}>
      日報 {isError ? "取得できませんでした" : (formatDateTimeShort(computedAt) ?? "未集計")}
    </p>
  )
}

/** ②③の加工日の期間 */
export function PeriodFilter({
  months,
  onChange,
}: {
  months: number | null
  onChange: (months: number | null) => void
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="加工日の期間">
      {PERIOD_OPTIONS.map((option) => (
        <Button
          key={option.label}
          variant={months === option.months ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={months === option.months}
          onClick={() => onChange(option.months)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

/** 一覧の取得中・取得の失敗（ページの本文に出す） */
export function ListStatus({ isLoading, isError }: { isLoading: boolean; isError: boolean }) {
  if (isError) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-red-600">
        日報の実績を取得できませんでした
      </div>
    )
  }
  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">読み込み中...</p>
  return null
}
