"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DailyReportWorkCounts } from "@/hooks/use-daily-report-worklist"
import { allocatedRatio, formatPercent, ratio } from "@/lib/daily-report-coverage-utils"
import {
  DAILY_REPORT_ALIASES_LABEL,
  DAILY_REPORT_PREREQUISITE_META,
  DAILY_REPORT_STOCK_META,
  DAILY_REPORT_WORK_META,
  dailyReportPageHref,
  type DailyReportPage,
  type DailyReportWorkKind,
} from "@/lib/daily-report-worklist-utils"
import { cn } from "@/lib/utils"
import { formatWorkCount, type WorkCount } from "@/lib/work-count"
import type { CoverageSummary } from "@/types/daily-report-progress"

interface QueueStep {
  kind: DailyReportWorkKind
  page: DailyReportPage
  /** 読み上げに使う番号（①） */
  no: string
  /** 丸の中に出す数字 */
  digit: number
  /** 対象を短く。仕組みの説明はヘルプに書く（docs/ui-writing-guidelines.md） */
  description: string
}

/** 作業のキューの並び（依存関係の順: 製品 → 工程 → 受注の有無） */
const STEPS: readonly QueueStep[] = [
  {
    kind: "products",
    page: "products",
    no: "①",
    digit: 1,
    description: "製品マスタに無い日報の製品",
  },
  {
    kind: "processes",
    page: "processes",
    no: "②",
    digit: 2,
    description: "工程ルートと日報の工程が合わない製品",
  },
  {
    kind: "unordered",
    page: "unordered",
    no: "③",
    digit: 3,
    description: "受注に結び付かなかった日報の実績",
  },
]

/**
 * 前提バナー（Issue #707）。①②③より先に片付けること（日報の顧客先）があるときだけ、
 * 「何が起きているか（1文）＋ボタン」で出す（docs/ui-writing-guidelines.md 4.5）
 */
export function DailyReportPrerequisiteBanner({ counts }: { counts: DailyReportWorkCounts }) {
  const { customer, prerequisiteProduct } = counts
  if (customer.isError) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <p>日報の表記を取得できませんでした</p>
      </div>
    )
  }
  const customers = customer.value ?? 0
  const products = prerequisiteProduct.value ?? 0
  if (customers === 0 && products === 0) return null
  const href = dailyReportPageHref("customers")

  return (
    <section
      aria-label="先に片付けること"
      className="flex flex-col divide-y divide-amber-200 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-950"
    >
      {customers > 0 && (
        <BannerLine
          text={`${DAILY_REPORT_PREREQUISITE_META.customer.label}のうち${customers}${DAILY_REPORT_PREREQUISITE_META.customer.unit}がアプリに未登録です`}
        >
          <Button asChild size="sm" variant="outline" className="bg-white">
            <Link href={href}>顧客を選ぶ</Link>
          </Button>
        </BannerLine>
      )}
      {products > 0 && (
        <BannerLine
          text={`${DAILY_REPORT_PREREQUISITE_META.product.label}が${products}${DAILY_REPORT_PREREQUISITE_META.product.unit}あります`}
        >
          <Button asChild size="sm" variant="outline" className="bg-white">
            <Link href={`${href}#products`}>確かめる</Link>
          </Button>
        </BannerLine>
      )}
    </section>
  )
}

function BannerLine({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2">
      <p className="flex min-w-0 flex-1 items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        {text}
      </p>
      {children}
    </div>
  )
}

/**
 * 日報の実績の作業のキュー（Issue #707）。依存関係の順（① → ② → ③）に縦に並べる。
 * 件数が0の作業は消さずに小さく「済み」と見せる（一巡したことが分かるように）。各作業は専用のページへ移る
 */
export function DailyReportWorkQueue({ counts }: { counts: DailyReportWorkCounts }) {
  const stepCounts: Record<DailyReportWorkKind, WorkCount> = {
    products: counts.products,
    processes: counts.processProducts,
    unordered: counts.unordered,
  }
  return (
    <nav aria-label="日報の実績の作業">
      <ol className="flex flex-col gap-2">
        {STEPS.map((step) => (
          <li key={step.kind} className="flex">
            <QueueStepLink step={step} count={stepCounts[step.kind]} />
          </li>
        ))}
      </ol>
    </nav>
  )
}

function QueueStepLink({ step, count }: { step: QueueStep; count: WorkCount }) {
  const meta = DAILY_REPORT_WORK_META[step.kind]
  const done = !count.isError && count.value === 0
  const text = formatWorkCount(count, meta.unit)
  return (
    <Link
      href={dailyReportPageHref(step.page)}
      aria-label={`${step.no} ${meta.label} ${done ? "済み" : text}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border bg-card text-left transition-colors hover:bg-accent",
        done ? "bg-muted/40 px-4 py-2" : "px-4 py-3",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-semibold",
          done
            ? "h-6 w-6 text-green-600"
            : "h-8 w-8 border border-foreground/30 text-base text-foreground",
        )}
      >
        {done ? <CheckCircle2 className="h-6 w-6" /> : step.digit}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("font-semibold", done ? "text-sm text-muted-foreground" : "text-base")}>
          {meta.label}
        </span>
        {done ? (
          <span className="text-xs font-medium text-green-700">済み</span>
        ) : (
          <span className="text-xs text-muted-foreground">{step.description}</span>
        )}
      </span>
      {!done && (
        <span
          className={cn(
            "shrink-0 text-2xl font-bold tabular-nums",
            count.isError && "text-sm font-normal text-red-600",
          )}
        >
          {count.isError || count.value === null ? (
            text
          ) : (
            <>
              {count.value}
              <span className="ml-0.5 text-sm font-normal">{meta.unit}</span>
            </>
          )}
        </span>
      )}
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}

/** 結び付いた割合のバーの区分（UI文言ガイドライン5章の画面語） */
const SEGMENTS = [
  { key: "allocated", label: "受注に結び付いた", color: "bg-emerald-500" },
  { key: "unallocated", label: "受注に結び付いていない", color: "bg-amber-400" },
  { key: "unmatched", label: "マスタに未登録", color: "bg-slate-400" },
] as const

/**
 * 参考（Issue #707）: 作り置き・結び付いた割合・登録済みの対応付け・対象外。
 * 作業のキューと違って片付けるものではないので、控えめに並べる
 */
export function DailyReportReference({
  counts,
  summary,
}: {
  counts: DailyReportWorkCounts
  /** 照合状況のサマリ。取得中・失敗・未集計なら null */
  summary: CoverageSummary | null
}) {
  const stockText = formatWorkCount(counts.stock, DAILY_REPORT_STOCK_META.unit)
  return (
    <section aria-labelledby="daily-report-reference" className="flex flex-col gap-1.5">
      <h2 id="daily-report-reference" className="text-xs font-semibold text-muted-foreground">
        参考
      </h2>
      <div className="flex flex-col divide-y rounded-lg border bg-card">
        <ReferenceLink
          href={dailyReportPageHref("stock")}
          label={DAILY_REPORT_STOCK_META.label}
          value={stockText}
          isError={counts.stock.isError}
        />
        {summary && <CoverageRatio summary={summary} />}
        <ReferenceLink href={dailyReportPageHref("aliases")} label={DAILY_REPORT_ALIASES_LABEL} />
      </div>
    </section>
  )
}

function ReferenceLink({
  href,
  label,
  value,
  isError = false,
}: {
  href: string
  label: string
  value?: string
  isError?: boolean
}) {
  return (
    <Link
      href={href}
      aria-label={value ? `${label} ${value}` : label}
      className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-accent"
    >
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 tabular-nums",
          isError && "text-red-600",
        )}
      >
        {value}
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
    </Link>
  )
}

function CoverageRatio({ summary }: { summary: CoverageSummary }) {
  const values = {
    allocated: summary.allocated_qty,
    unallocated: summary.unallocated_qty,
    unmatched: summary.unmatched_qty,
  }
  const share = (qty: number) => formatPercent(ratio(qty, summary.total_qty))
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">受注に結び付いた実績</span>
        <span className="tabular-nums">
          <span className="font-semibold">{formatPercent(allocatedRatio(summary))}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {summary.allocated_qty.toLocaleString()} / {summary.total_qty.toLocaleString()}個
          </span>
        </span>
      </div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={SEGMENTS.map((s) => `${s.label} ${share(values[s.key])}`).join("、")}
      >
        {SEGMENTS.map((s) => {
          const r = ratio(values[s.key], summary.total_qty)
          return r ? <div key={s.key} className={s.color} style={{ width: `${r * 100}%` }} /> : null
        })}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
        {SEGMENTS.map((s) => (
          <li key={s.key} className="inline-flex items-center gap-1 tabular-nums">
            <span aria-hidden className={cn("h-2 w-2 rounded-full", s.color)} />
            {s.label} {share(values[s.key])}
          </li>
        ))}
      </ul>
    </div>
  )
}
