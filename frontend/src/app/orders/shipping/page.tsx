"use client"

import { useMemo, type ReactNode } from "react"
import Link from "next/link"
import { Info } from "lucide-react"
import {
  ShippingOrderHeaderRow,
  ShippingOrderRow,
} from "@/components/orders/shipping/shipping-order-row"
import { OrdersTable } from "@/components/orders/orders-table"
import { useOrderActions } from "@/hooks/use-order-actions"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import { formatDateTimeShort, formatDeadlineShort } from "@/lib/order-utils"
import { ShipmentImportStatus } from "@/components/orders/shipping/shipment-import-status"
import {
  SHIPPING_PANEL_ID,
  ShippingPrerequisiteBanner,
  ShippingWorkQueue,
  type ShippingWorkCount,
} from "@/components/orders/shipping/shipping-hub"
import { UnmatchedShipmentEntries } from "@/components/orders/shipping/unmatched-shipment-entries"
import { ShipmentOrderReviews } from "@/components/orders/shipping/shipment-order-reviews"
import { ListPageLayout } from "@/components/layout/list-page-layout"
import { useLocationHash } from "@/hooks/use-location-hash"
import { toValidShippingPanel, type ShippingPanel } from "@/lib/shipping-review-utils"
import {
  SHIPPING_DAILY_REPORT_META,
  SHIPPING_PREREQUISITE_META,
  SHIPPING_WORK_META,
  type ShippingWorklistOrder,
} from "@/lib/shipping-worklist-utils"
import type { ShipmentOrderReview, ShipmentOrderReviewList } from "@/types/shipment"

/**
 * 送品の消し込み（Issue #557 / #692、Epic #690）
 * URL: /orders/shipping
 *
 * 順番と前提が見える作業キュー（ハブ）。件数は `classifyShippingWorklist()`（#691）の結果から出し、一覧の行も同じ結果から出す。
 *
 * - 前提バナー: 弥生の名寄せが済んでいない得意先・商品と、送品先の受注が1件に決まらない明細があるときだけ出す
 * - ① 送品済みにする: 弥生で受注数量の送品を確かめられた注文。送品の記録は弥生が正なので、自動では送品済みにせず、
 *   担当者が内容を見て1件ずつ押す。送品できるのは社長・受注担当で、それ以外のロールは閲覧のみ
 * - ② 出荷を確かめる: 弥生ではまだ確かめられていない注文。ここからは送品済みにしない
 * - ③ 受注を起票する: 名寄せは済んでいるのに受注が無い弥生の明細
 * - 参考: 弥生の送品数に日報の実績が届いていない注文（①②の行にも印を付ける）
 *
 * 選んだ作業の一覧はハブの横に出す（選択は URL のハッシュ）。#693 で一覧を専用のページへ移す
 */
export default function OrdersShippingPage() {
  const {
    orders,
    products,
    customers,
    isLoading,
    currentUserRole,
    worklist,
    computedAt,
    isProgressError,
    latestSalesDate,
    isShipmentError,
    unmatched,
    orderReviews,
  } = useOrdersShipping()
  const actions = useOrderActions(orders)
  const [hash, setHash] = useLocationHash()
  const panel = toValidShippingPanel(hash)
  const computedAtLabel = formatDateTimeShort(computedAt)

  // 取得中は件数を出さない（途中の件数を出さない）。取得に失敗した作業は「取得できませんでした」
  const orderCount = (value: number): ShippingWorkCount => ({
    value: isLoading || isShipmentError ? null : value,
    isError: isShipmentError,
  })
  const counts: Record<"ship" | "confirm" | "register" | "dailyReport", ShippingWorkCount> = {
    ship: orderCount(worklist.counts.ship),
    confirm: orderCount(worklist.counts.confirm),
    register: { value: worklist.counts.register, isError: unmatched.isError },
    dailyReport: {
      value: isLoading ? null : worklist.counts.dailyReport,
      isError: orderReviews.isError,
    },
  }

  // 日報の参考の一覧は、件数と同じく振り分けた注文の分だけを出す
  const dailyReportData = useMemo<ShipmentOrderReviewList | undefined>(
    () =>
      orderReviews.data && {
        ...orderReviews.data,
        items: worklist.dailyReportOrders
          .map((o) => o.marks.dailyReport)
          .filter((r): r is ShipmentOrderReview => r !== null),
      },
    [orderReviews.data, worklist.dailyReportOrders],
  )

  const renderOrders = (rows: ShippingWorklistOrder[], showShipAction: boolean, empty: string) =>
    isShipmentError ? (
      <div className="rounded-lg border bg-card p-8 text-center text-red-600">
        弥生の送品を取得できませんでした
      </div>
    ) : (
      <OrdersTable
        fill
        isLoading={isLoading}
        header={<ShippingOrderHeaderRow />}
        rowCount={rows.length}
        emptyState={<p>{empty}</p>}
      >
        {rows.map((row) => (
          <ShippingOrderRow
            key={row.order.id}
            row={row}
            products={products}
            customers={customers}
            currentUserRole={currentUserRole}
            review={row.marks.dailyReport}
            showShipAction={showShipAction}
            {...actions.getRowProps(row.order)}
          />
        ))}
      </OrdersTable>
    )

  const panels: Record<
    ShippingPanel,
    { title: string; count: string; hint?: string; body: ReactNode }
  > = {
    ship: {
      title: `① ${SHIPPING_WORK_META.ship.label}`,
      count: countLabel(counts.ship, SHIPPING_WORK_META.ship.unit),
      hint: "弥生で受注数量の送品を確かめられた注文です。内容を見て「送品済みにする」を押してください（自動では送品済みにしません）",
      body: renderOrders(worklist.ship, true, "送品済みにする注文はありません"),
    },
    confirm: {
      title: `② ${SHIPPING_WORK_META.confirm.label}`,
      count: countLabel(counts.confirm, SHIPPING_WORK_META.confirm.unit),
      hint: "弥生でこの注文の出荷（売上の計上）を確かめてください。計上された明細が取り込まれると①送品済みにするへ移ります。ここからは送品済みにしません",
      body: renderOrders(worklist.confirm, false, "出荷を確かめる注文はありません"),
    },
    register: {
      title: `③ ${SHIPPING_WORK_META.register.label}`,
      count: countLabel(counts.register, SHIPPING_WORK_META.register.unit),
      body: (
        <UnmatchedShipmentEntries
          data={unmatched.data}
          items={worklist.register}
          emptyState="起票する受注はありません"
          isLoading={unmatched.isLoading}
          isError={unmatched.isError}
          orders={orders}
          products={products}
          customers={customers}
        />
      ),
    },
    ambiguous: {
      title: SHIPPING_PREREQUISITE_META.ambiguous.label,
      count: countLabel(
        {
          value: worklist.counts.prerequisite?.ambiguous ?? null,
          isError: unmatched.isError,
        },
        SHIPPING_PREREQUISITE_META.ambiguous.unit,
      ),
      body: (
        <UnmatchedShipmentEntries
          data={unmatched.data}
          items={worklist.prerequisite.ambiguous}
          emptyState="送品先の受注が1件に決まらない弥生の明細はありません"
          isLoading={unmatched.isLoading}
          isError={unmatched.isError}
          orders={orders}
          products={products}
          customers={customers}
        />
      ),
    },
    "daily-reports": {
      title: SHIPPING_DAILY_REPORT_META.label,
      count: countLabel(counts.dailyReport, SHIPPING_DAILY_REPORT_META.unit),
      body: (
        <ShipmentOrderReviews
          data={dailyReportData}
          isLoading={orderReviews.isLoading || isLoading}
          isError={orderReviews.isError}
          orders={orders}
          products={products}
          customers={customers}
        />
      ),
    },
  }
  const current = panels[panel]

  return (
    <ListPageLayout
      title="送品の消し込み"
      description="弥生の売上明細と日報の進捗から、送品の消し込みでやることを片付ける順に並べています"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <ShipmentImportStatus />
        <p>
          {isShipmentError
            ? "弥生の売上明細を取得できませんでした"
            : latestSalesDate
              ? `弥生の売上明細: ${formatDeadlineShort(latestSalesDate)} 売上分まで`
              : "弥生の売上明細はまだ解析されていません"}
        </p>
        <p>
          {isProgressError
            ? "日報の進捗を取得できませんでした（②は納期だけで判定しています）"
            : computedAtLabel
              ? `日報の進捗: ${computedAtLabel} 時点`
              : "日報の進捗はまだ集計されていません"}
        </p>
        <Link href="/orders/shipment-names" className="underline hover:text-foreground">
          弥生の名寄せ
        </Link>
      </div>

      <ShippingPrerequisiteBanner
        counts={worklist.counts.prerequisite}
        isError={unmatched.isError}
        truncated={worklist.truncated}
        onOpenAmbiguous={() => setHash("ambiguous")}
      />

      {/* 画面の幅ではなく本文の幅で2列にする（サイドバーを開いたタブレットでは1列。幅 80rem は shipping-hub の作業キューと揃える） */}
      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 @[80rem]:flex-row">
          <div className="flex shrink-0 flex-col gap-3 @[80rem]:w-[22rem] @[80rem]:overflow-y-auto @[80rem]:pr-1">
            <div
              role="note"
              className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                送品の記録は弥生が正です。①は弥生で送品を確かめられた注文なので、ここで送品済みにします。
                ②は弥生でまだ確かめられていない注文なので、弥生で出荷を確かめるだけにし、ここでは送品済みにしません
              </p>
            </div>
            <ShippingWorkQueue
              counts={counts}
              registerTruncated={worklist.truncated}
              selected={panel}
              onSelect={setHash}
            />
          </div>

          <section
            id={SHIPPING_PANEL_ID}
            aria-label={current.title}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
          >
            <div className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold">
                {current.title}
                <span className="ml-2 text-base font-normal text-muted-foreground tabular-nums">
                  {current.count}
                </span>
              </h2>
              {current.hint && <p className="text-xs text-muted-foreground">{current.hint}</p>}
            </div>
            {current.body}
          </section>
        </div>
      </div>
    </ListPageLayout>
  )
}

function countLabel(count: ShippingWorkCount, unit: string): string {
  if (count.isError) return "－"
  return count.value === null ? "－" : `${count.value}${unit}`
}
