"use client"

import Link from "next/link"
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ShippingPanel } from "@/lib/shipping-review-utils"
import {
  SHIPPING_DAILY_REPORT_META,
  SHIPPING_PREREQUISITE_META,
  SHIPPING_WORK_META,
  type ShippingPrerequisiteKind,
  type ShippingWorkKind,
} from "@/lib/shipping-worklist-utils"
import { cn } from "@/lib/utils"

/** 選択中の作業の一覧の要素 ID。作業のボタンの `aria-controls` に使う */
export const SHIPPING_PANEL_ID = "shipping-panel"

/** 作業の件数。`value` は取得中・取得に失敗したときは null */
export interface ShippingWorkCount {
  value: number | null
  isError: boolean
}

type QueueWorkKind = Extract<ShippingWorkKind, "ship" | "confirm" | "register">

interface QueueStep {
  kind: QueueWorkKind
  panel: ShippingPanel
  /** 見出し・読み上げに使う番号（①） */
  no: string
  /** 丸の中に出す数字 */
  digit: number
  description: string
}

/** 作業キューの並び（片付ける順）。①②がこの画面の本来の仕事、③は付随の仕事 */
const MAIN_STEPS: readonly QueueStep[] = [
  {
    kind: "ship",
    panel: "ship",
    no: "①",
    digit: 1,
    description: "弥生で受注数量の送品を確かめられた注文です。内容を見て送品済みにします",
  },
  {
    kind: "confirm",
    panel: "confirm",
    no: "②",
    digit: 2,
    description:
      "弥生ではまだ受注数量の送品を確かめられていない注文のうち、最終工程が完了した・納期を過ぎた・納期が近いものです。弥生で出荷を確かめます",
  },
]

const SUB_STEP: QueueStep = {
  kind: "register",
  panel: "register",
  no: "③",
  digit: 3,
  description: "弥生では送品したのに、アプリに受注が無い商品です。注文書を確かめて起票します",
}

function countText(count: ShippingWorkCount, unit: string): string {
  if (count.isError) return "取得できませんでした"
  return count.value === null ? "－" : `${count.value}${unit}`
}

interface PrerequisiteBannerProps {
  /** 前提の件数。取得中・取得に失敗したときは null */
  counts: Record<ShippingPrerequisiteKind, number> | null
  isError: boolean
  /** 弥生の明細が上限で切られている（件数が実際より少ない） */
  truncated: boolean
  /** 送品先の受注を見分ける一覧を開く */
  onOpenAmbiguous: () => void
}

/**
 * 前提バナー（Issue #692）。①②③より先に片付けること（弥生の名寄せ・送品先の受注の見分け）があるときだけ出す。
 * 名寄せが済まない明細は受注と結び付かず、①にも③にも入らないので、下流の件数が変わることを書く
 */
export function ShippingPrerequisiteBanner({
  counts,
  isError,
  truncated,
  onOpenAmbiguous,
}: PrerequisiteBannerProps) {
  if (isError) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          弥生の明細を取得できませんでした。名寄せが済んでいない得意先・商品と、③受注を起票するの件数を出せません
        </p>
      </div>
    )
  }
  if (!counts) return null
  const nameParts = (["customer", "product"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${SHIPPING_PREREQUISITE_META[kind].unit} ${counts[kind]}件`)
  if (nameParts.length === 0 && counts.ambiguous === 0) return null

  return (
    <section
      aria-label="先に片付けること"
      className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
    >
      <h2 className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        先に片付けること
      </h2>
      {nameParts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1">
            弥生の{nameParts.join("・")}が、アプリの顧客・製品と結び付いていません。
            名寄せを済ませると、その明細が受注と結び付き、①送品済みにする・③受注を起票するの件数が変わります
            {truncated && "（件数が多いため一部だけを数えています）"}
          </p>
          <div className="flex flex-wrap gap-2">
            {counts.customer > 0 && (
              <Button asChild size="sm" variant="outline" className="bg-white">
                <Link href="/orders/shipment-names#customers">
                  {SHIPPING_PREREQUISITE_META.customer.label}
                </Link>
              </Button>
            )}
            {counts.product > 0 && (
              <Button asChild size="sm" variant="outline" className="bg-white">
                <Link href="/orders/shipment-names#products">
                  {SHIPPING_PREREQUISITE_META.product.label}
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
      {counts.ambiguous > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1">
            送品先の受注が1件に決まらない弥生の{SHIPPING_PREREQUISITE_META.ambiguous.unit}が{" "}
            {counts.ambiguous}件あります。
            受注の顧客注文番号・希望納期を弥生の備考に合わせると、その数量が受注に入り、①送品済みにするへ進められます
          </p>
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            aria-controls={SHIPPING_PANEL_ID}
            onClick={onOpenAmbiguous}
          >
            {SHIPPING_PREREQUISITE_META.ambiguous.label}
          </Button>
        </div>
      )}
    </section>
  )
}

interface ShippingWorkQueueProps {
  counts: Record<QueueWorkKind | "dailyReport", ShippingWorkCount>
  /** ③が上限で切られている（件数が実際より少ない） */
  registerTruncated: boolean
  selected: ShippingPanel
  onSelect: (panel: ShippingPanel) => void
}

/**
 * 送品の消し込みの作業キュー（Issue #692）。均等なメニューにせず、片付ける順（①→②、付随の③、参考の日報）に並べ、
 * ①を主の作業として強く見せる。件数が0の作業は消さずに「済み」と見せる
 */
export function ShippingWorkQueue({
  counts,
  registerTruncated,
  selected,
  onSelect,
}: ShippingWorkQueueProps) {
  const daily = counts.dailyReport
  return (
    // 2列の画面（本文の幅 80rem 以上、page.tsx）では縦1列、1列の画面では横に並べて一覧の高さを残す
    <nav aria-label="送品の消し込みの作業" className="flex flex-col gap-4">
      <ol className="grid grid-cols-1 gap-2 @[48rem]:grid-cols-2 @[80rem]:grid-cols-1">
        {MAIN_STEPS.map((step) => (
          <li key={step.kind} className="flex">
            <QueueStepButton
              step={step}
              count={counts[step.kind]}
              primary={step.kind === "ship"}
              selected={selected === step.panel}
              onSelect={onSelect}
            />
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 @[48rem]:grid-cols-2 @[80rem]:grid-cols-1">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground">あわせてやること</h2>
          <QueueStepButton
            step={SUB_STEP}
            count={counts.register}
            note={registerTruncated ? "件数が多いため一部だけを数えています" : undefined}
            selected={selected === SUB_STEP.panel}
            onSelect={onSelect}
            compact
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-xs font-semibold text-muted-foreground">参考</h2>
          <button
            type="button"
            aria-pressed={selected === "daily-reports"}
            aria-controls={SHIPPING_PANEL_ID}
            aria-label={`${SHIPPING_DAILY_REPORT_META.label} ${countText(daily, SHIPPING_DAILY_REPORT_META.unit)}`}
            className={cn(
              "flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
              selected === "daily-reports" && "bg-accent ring-1 ring-border",
            )}
            onClick={() => onSelect("daily-reports")}
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
              {countText(daily, SHIPPING_DAILY_REPORT_META.unit)}
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          </button>
        </div>
      </div>
    </nav>
  )
}

function QueueStepButton({
  step,
  count,
  primary = false,
  compact = false,
  note,
  selected,
  onSelect,
}: {
  step: QueueStep
  count: ShippingWorkCount
  primary?: boolean
  compact?: boolean
  note?: string
  selected: boolean
  onSelect: (panel: ShippingPanel) => void
}) {
  const meta = SHIPPING_WORK_META[step.kind]
  const done = !count.isError && count.value === 0
  const text = countText(count, meta.unit)
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-controls={SHIPPING_PANEL_ID}
      aria-label={`${step.no} ${meta.label} ${done ? "済み" : text}`}
      className={cn(
        "flex h-full w-full items-start gap-3 rounded-lg border bg-card text-left transition-colors hover:bg-accent",
        compact ? "px-3 py-2" : "px-4 py-3",
        primary && !done && "border-blue-300 bg-blue-50/60 hover:bg-blue-50",
        done && "bg-muted/40",
        selected && (primary && !done ? "ring-2 ring-blue-500" : "ring-2 ring-foreground/30"),
      )}
      onClick={() => onSelect(step.panel)}
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
                <span className="ml-0.5 text-sm font-normal">{meta.unit}</span>
              </>
            )}
          </span>
        </span>
        {done ? (
          <span className="text-xs font-medium text-green-700">済み（今やることはありません）</span>
        ) : (
          <span className="text-xs text-muted-foreground">{step.description}</span>
        )}
        {note && !done && <span className="text-xs text-amber-700">{note}</span>}
      </span>
    </button>
  )
}
