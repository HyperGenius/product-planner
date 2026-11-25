"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { ListPageLayout } from "@/components/layout/list-page-layout"
import { ShippingHelp } from "@/components/orders/shipping/shipping-help"
import { formatDateTimeShort, formatDeadlineShort } from "@/lib/order-utils"
import { SHIPPING_HUB_HREF } from "@/lib/shipping-review-utils"
import { formatWorkCount, type ShippingWorkCount } from "@/lib/shipping-worklist-utils"
import { cn } from "@/lib/utils"

/** データの鮮度に出す値（`useOrdersShipping()` の戻り値をそのまま渡す） */
export interface ShippingFreshness {
  latestSalesDate: string | null
  isShipmentError: boolean
  computedAt: string | null
  isProgressError: boolean
}

interface ShippingPageLayoutProps extends ShippingFreshness {
  /** 見出し（「① 送品済みにする」） */
  title: string
  count: ShippingWorkCount
  unit: string
  children: ReactNode
}

/**
 * 送品の消し込みのハブから開く一覧のページの外枠（Issue #693）。ハブへ戻るリンク・件数付きの見出し・
 * 見出しの横のヘルプ（ハブと共有の `ShippingHelp`）・データの鮮度を置き、一覧は残りの高さでスクロールさせる。
 * 件数はハブと同じ値（`useOrdersShipping().counts`）を渡し、一覧の行数と一致させる
 */
export function ShippingPageLayout({
  title,
  count,
  unit,
  children,
  latestSalesDate,
  isShipmentError,
  computedAt,
  isProgressError,
}: ShippingPageLayoutProps) {
  const freshness = { latestSalesDate, isShipmentError, computedAt, isProgressError }
  return (
    <ListPageLayout
      back={
        <Link
          href={SHIPPING_HUB_HREF}
          className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          送品の消し込み
        </Link>
      }
      title={
        <>
          {title}
          <span
            className={cn(
              "ml-3 text-lg font-normal tabular-nums text-muted-foreground",
              count.isError && "text-base text-red-600",
            )}
          >
            {formatWorkCount(count, unit)}
          </span>
        </>
      }
      help={<ShippingHelp />}
    >
      <DataFreshness {...freshness} />
      {children}
    </ListPageLayout>
  )
}

/**
 * データの鮮度（docs/ui-writing-guidelines.md 4.7）。ソースごとに「どこまでのデータか」だけを1行に出し、
 * 取得に失敗したときだけ目立たせる。弥生の取り込みは不定期なので、日数での警告は出さない（#662）
 */
export function DataFreshness({
  latestSalesDate,
  isShipmentError,
  computedAt,
  isProgressError,
}: ShippingFreshness) {
  const computedAtLabel = formatDateTimeShort(computedAt)
  return (
    <p className="text-xs text-muted-foreground">
      <span className={cn(isShipmentError && "font-medium text-red-600")}>
        弥生{" "}
        {isShipmentError
          ? "取得できませんでした"
          : latestSalesDate
            ? `${formatDeadlineShort(latestSalesDate)}売上分まで`
            : "未取り込み"}
      </span>
      ・
      <span className={cn(isProgressError && "font-medium text-red-600")}>
        日報 {isProgressError ? "取得できませんでした" : (computedAtLabel ?? "未集計")}
      </span>
    </p>
  )
}
