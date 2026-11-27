"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, CheckCircle2, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { shipmentNamesHref } from "@/lib/shipment-utils"
import type { ShippingCountChange } from "@/lib/shipping-count-history"
import { shippingPageHref, type ShippingPage } from "@/lib/shipping-review-utils"
import {
  SHIPPING_DAILY_REPORT_META,
  SHIPPING_PREREQUISITE_META,
  SHIPPING_WORK_META,
  formatWorkCount,
  type ShippingPrerequisiteKind,
  type ShippingWorkCount,
  type ShippingWorkKind,
} from "@/lib/shipping-worklist-utils"
import { cn } from "@/lib/utils"

type QueueWorkKind = Extract<ShippingWorkKind, "ship" | "confirm" | "register">

interface QueueStep {
  kind: QueueWorkKind
  page: ShippingPage
  /** 読み上げに使う番号（①） */
  no: string
  /** 丸の中に出す数字 */
  digit: number
  /** 対象を短く。仕組みの説明はヘルプに書く（docs/ui-writing-guidelines.md） */
  description: string
}

/** 作業キューの並び（片付ける順）。①②がこの画面の本来の仕事、③は付随の仕事 */
const MAIN_STEPS: readonly QueueStep[] = [
  {
    kind: "ship",
    page: "ship",
    no: "①",
    digit: 1,
    description: "弥生で出荷済み。確認して送品済みにする",
  },
  {
    kind: "confirm",
    page: "confirm",
    no: "②",
    digit: 2,
    description: "弥生に未計上。出荷したか確かめる",
  },
]

const SUB_STEP: QueueStep = {
  kind: "register",
  page: "register",
  no: "③",
  digit: 3,
  description: "弥生で出荷済みで、受注が無い",
}

interface PrerequisiteBannerProps {
  /** 前提の件数。取得中・取得に失敗したときは null */
  counts: Record<ShippingPrerequisiteKind, number> | null
  isError: boolean
  /** 弥生の明細が上限で切られている（件数が実際より少ない） */
  truncated: boolean
}

/**
 * 前提バナー（Issue #692）。①②③より先に片付けること（弥生の名寄せ・送り先の受注）があるときだけ、
 * 「何が起きているか（1文）＋ボタン」で出す。対処すると件数がどう変わるかはヘルプに書く（docs/ui-writing-guidelines.md 4.5）
 */
export function ShippingPrerequisiteBanner({
  counts,
  isError,
  truncated,
}: PrerequisiteBannerProps) {
  if (isError) {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <p>弥生の明細を取得できませんでした</p>
      </div>
    )
  }
  if (!counts) return null
  const more = truncated ? "以上" : ""
  const nameParts = (["customer", "product"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${SHIPPING_PREREQUISITE_META[kind].unit}${counts[kind]}件${more}`)
  if (nameParts.length === 0 && counts.ambiguous === 0) return null
  // 得意先が決まらないと商品も名寄せできないので、得意先が残っていれば得意先のタブを開く
  // 送品の消し込みから開いたことを渡し、名寄せの画面に戻るリンクを出してこの画面と同じ期間に絞る（#694）
  const namesHref = shipmentNamesHref(counts.customer > 0 ? "customers" : "products", {
    fromShipping: true,
  })

  return (
    <section
      aria-label="先に片付けること"
      className="flex flex-col divide-y divide-amber-200 rounded-lg border border-amber-300 bg-amber-50 text-sm text-amber-950"
    >
      {nameParts.length > 0 && (
        <BannerLine text={`弥生の${nameParts.join("・")}がアプリに未登録です`}>
          <Button asChild size="sm" variant="outline" className="bg-white">
            <Link href={namesHref}>名寄せする</Link>
          </Button>
        </BannerLine>
      )}
      {counts.ambiguous > 0 && (
        <BannerLine
          text={`送り先の受注を決められない明細があります（${counts.ambiguous}${SHIPPING_PREREQUISITE_META.ambiguous.unit}${more}）`}
        >
          <Button asChild size="sm" variant="outline" className="bg-white">
            <Link href={shippingPageHref("ambiguous")}>受注を確かめる</Link>
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
 * 前回ハブを見たときからの件数の増減（Issue #694）。名寄せ・起票・送品済みにするの結果が①③・前提に効いたことを見せる。
 * 変わった件数だけを出し、何も変わっていなければ出さない
 */
export function ShippingCountChanges({ changes }: { changes: readonly ShippingCountChange[] }) {
  if (changes.length === 0) return null
  return (
    <section
      aria-label="前回からの件数の変化"
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground"
    >
      <span className="inline-flex items-center gap-1 font-medium text-foreground">
        <History className="h-4 w-4 self-center" />
        前回から
      </span>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {changes.map((change) => (
          <li key={change.kind} className="tabular-nums">
            {change.label} {change.from} →{" "}
            <span className="font-semibold text-foreground">{change.to}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface ShippingWorkQueueProps {
  counts: Record<QueueWorkKind | "dailyReport", ShippingWorkCount>
}

/**
 * 送品の消し込みの作業キュー（Issue #692 / #693）。均等なメニューにせず、片付ける順（①→②、付随の③、参考の日報）に並べ、
 * ①を主の作業として強く見せる。件数が0の作業は消さずに「済み」と見せる。各作業は専用のページへ移る
 */
export function ShippingWorkQueue({ counts }: ShippingWorkQueueProps) {
  const daily = counts.dailyReport
  const dailyText = formatWorkCount(daily, SHIPPING_DAILY_REPORT_META.unit)
  return (
    // 本文の幅が広ければ2列（画面の幅ではなく本文の幅で決める。サイドバーを開いたタブレットでは1列）
    <nav aria-label="送品の消し込みの作業" className="@container flex flex-col gap-4">
      <ol className="grid grid-cols-1 gap-3 @[40rem]:grid-cols-2">
        {MAIN_STEPS.map((step) => (
          <li key={step.kind} className="flex">
            <QueueStepLink step={step} count={counts[step.kind]} primary={step.kind === "ship"} />
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 @[40rem]:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground">あわせてやること</h2>
          <QueueStepLink step={SUB_STEP} count={counts.register} compact />
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground">参考</h2>
          <Link
            href={shippingPageHref("daily-reports")}
            aria-label={`${SHIPPING_DAILY_REPORT_META.label} ${dailyText}`}
            className="flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <span className="min-w-0 text-muted-foreground">
              {SHIPPING_DAILY_REPORT_META.label}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1 tabular-nums",
                daily.isError && "text-red-600",
              )}
            >
              {dailyText}
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </Link>
        </div>
      </div>
    </nav>
  )
}

function QueueStepLink({
  step,
  count,
  primary = false,
  compact = false,
}: {
  step: QueueStep
  count: ShippingWorkCount
  primary?: boolean
  compact?: boolean
}) {
  const meta = SHIPPING_WORK_META[step.kind]
  const done = !count.isError && count.value === 0
  const text = formatWorkCount(count, meta.unit)
  return (
    <Link
      href={shippingPageHref(step.page)}
      aria-label={`${step.no} ${meta.label} ${done ? "済み" : text}`}
      className={cn(
        "flex h-full w-full items-start gap-3 rounded-lg border bg-card text-left transition-colors hover:bg-accent",
        compact ? "px-3 py-2" : "px-4 py-3",
        primary && !done && "border-blue-300 bg-blue-50/60 hover:bg-blue-50",
        done && "bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-semibold",
          compact ? "h-6 w-6 text-sm" : "h-8 w-8 text-base",
          done
            ? "text-green-600"
            : primary
              ? "bg-blue-600 text-white"
              : "border border-foreground/30 text-foreground",
        )}
      >
        {done ? <CheckCircle2 className={compact ? "h-5 w-5" : "h-7 w-7"} /> : step.digit}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span
            className={cn(
              "font-semibold",
              primary ? "text-lg" : compact ? "text-sm" : "text-base",
              done && "text-muted-foreground",
            )}
          >
            {meta.label}
          </span>
          <span
            className={cn(
              "tabular-nums",
              compact ? "text-base" : "text-2xl font-bold",
              done && "text-muted-foreground",
              count.isError && "text-sm font-normal text-red-600",
            )}
          >
            {count.isError || count.value === null ? (
              text
            ) : (
              <>
                {count.value}
                <span className="ml-0.5 text-sm font-normal">
                  {meta.unit}
                  {count.atLeast && "以上"}
                </span>
              </>
            )}
          </span>
        </span>
        {done ? (
          <span className="text-xs font-medium text-green-700">済み</span>
        ) : (
          <span className="text-xs text-muted-foreground">{step.description}</span>
        )}
      </span>
    </Link>
  )
}
