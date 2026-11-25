"use client"

import { useMemo, type ReactNode } from "react"
import {
  ShippingOrderHeaderRow,
  ShippingOrderRow,
  type ShippingOrderRowVariant,
} from "@/components/orders/shipping/shipping-order-row"
import { OrdersTable } from "@/components/orders/orders-table"
import { useOrderActions } from "@/hooks/use-order-actions"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import { formatDateTimeShort, formatDeadlineShort } from "@/lib/order-utils"
import {
  SHIPPING_PANEL_ID,
  ShippingPrerequisiteBanner,
  ShippingWorkQueue,
  formatWorkCount,
  type ShippingWorkCount,
} from "@/components/orders/shipping/shipping-hub"
import { ShippingHelp } from "@/components/orders/shipping/shipping-help"
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
import { cn } from "@/lib/utils"
import type { ShipmentOrderReview, ShipmentOrderReviewList } from "@/types/shipment"

/**
 * 送品の消し込み（Issue #557 / #692、Epic #690）
 * URL: /orders/shipping
 *
 * 順番と前提が見える作業キュー（ハブ）。件数は `classifyShippingWorklist()`（#691）の結果から出し、一覧の行も同じ結果から出す。
 *
 * - 前提バナー: 弥生の名寄せが済んでいない得意先・商品と、送り先の受注を決められない明細があるときだけ出す
 * - ① 送品済みにする: 弥生で受注数量の送品を確かめられた注文。送品の記録は弥生が正なので、自動では送品済みにせず、
 *   担当者が内容を見て1件ずつ押す。送品できるのは社長・受注担当で、それ以外のロールは閲覧のみ
 * - ② 出荷を確かめる: 弥生ではまだ確かめられていない注文。ここからは送品済みにしない（ボタンを置かないことで表す）
 * - ③ 受注を起票する: 名寄せは済んでいるのに受注が無い弥生の明細
 * - 参考: 日報が未入力の出荷済み注文（①②の行にも印を付ける）
 *
 * 画面の文言は docs/ui-writing-guidelines.md に従う。仕組み・判定条件・抽出条件は `ShippingHelp`（見出しの横の「?」）に書く。
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

  // 取得中は件数を出さない（途中の件数を出さない）。取得に失敗した作業は「取得できませんでした」
  const orderCount = (value: number): ShippingWorkCount => ({
    value: isLoading || isShipmentError ? null : value,
    isError: isShipmentError,
  })
  const counts: Record<"ship" | "confirm" | "register" | "dailyReport", ShippingWorkCount> = {
    ship: orderCount(worklist.counts.ship),
    confirm: orderCount(worklist.counts.confirm),
    register: {
      value: worklist.counts.register,
      isError: unmatched.isError,
      atLeast: worklist.truncated,
    },
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

  const renderOrders = (
    rows: ShippingWorklistOrder[],
    variant: ShippingOrderRowVariant,
    empty: string,
  ) =>
    isShipmentError ? (
      <div className="rounded-lg border bg-card p-8 text-center text-red-600">
        弥生の送品を取得できませんでした
      </div>
    ) : (
      <OrdersTable
        fill
        isLoading={isLoading}
        header={<ShippingOrderHeaderRow variant={variant} />}
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
            variant={variant}
            {...actions.getRowProps(row.order)}
          />
        ))}
      </OrdersTable>
    )

  const panels: Record<
    ShippingPanel,
    { title: string; count: ShippingWorkCount; unit: string; body: ReactNode }
  > = {
    ship: {
      title: `① ${SHIPPING_WORK_META.ship.label}`,
      count: counts.ship,
      unit: SHIPPING_WORK_META.ship.unit,
      body: renderOrders(worklist.ship, "ship", "送品済みにする注文はありません"),
    },
    confirm: {
      title: `② ${SHIPPING_WORK_META.confirm.label}`,
      count: counts.confirm,
      unit: SHIPPING_WORK_META.confirm.unit,
      body: renderOrders(worklist.confirm, "confirm", "出荷を確かめる注文はありません"),
    },
    register: {
      title: `③ ${SHIPPING_WORK_META.register.label}`,
      count: counts.register,
      unit: SHIPPING_WORK_META.register.unit,
      body: (
        <UnmatchedShipmentEntries
          items={worklist.register}
          rowAction="register"
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
      count: {
        value: worklist.counts.prerequisite?.ambiguous ?? null,
        isError: unmatched.isError,
        atLeast: worklist.truncated,
      },
      unit: SHIPPING_PREREQUISITE_META.ambiguous.unit,
      body: (
        <UnmatchedShipmentEntries
          items={worklist.prerequisite.ambiguous}
          emptyState="送り先の受注を決められない明細はありません"
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
      count: counts.dailyReport,
      unit: SHIPPING_DAILY_REPORT_META.unit,
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
    <ListPageLayout title="送品の消し込み" help={<ShippingHelp />}>
      <DataFreshness
        latestSalesDate={latestSalesDate}
        isShipmentError={isShipmentError}
        computedAt={computedAt}
        isProgressError={isProgressError}
      />

      <ShippingPrerequisiteBanner
        counts={worklist.counts.prerequisite}
        isError={unmatched.isError}
        truncated={worklist.truncated}
        onOpenAmbiguous={() => setHash("ambiguous")}
      />

      {/* 画面の幅ではなく本文の幅で2列にする（サイドバーを開いたタブレットでは1列。幅 80rem は shipping-hub の作業キューと揃える） */}
      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 @[80rem]:flex-row">
          <div className="flex shrink-0 flex-col @[80rem]:w-[22rem] @[80rem]:overflow-y-auto @[80rem]:pr-1">
            <ShippingWorkQueue counts={counts} selected={panel} onSelect={setHash} />
          </div>

          <section
            id={SHIPPING_PANEL_ID}
            aria-label={current.title}
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
          >
            <h2 className="text-lg font-semibold">
              {current.title}
              <span className="ml-2 text-base font-normal text-muted-foreground tabular-nums">
                {current.count.isError ? "－" : formatWorkCount(current.count, current.unit)}
              </span>
            </h2>
            {current.body}
          </section>
        </div>
      </div>
    </ListPageLayout>
  )
}

/**
 * データの鮮度（docs/ui-writing-guidelines.md 4.7）。ソースごとに「どこまでのデータか」だけを1行に出し、
 * 取得に失敗したときだけ目立たせる。弥生の取り込みは不定期なので、日数での警告は出さない（#662）
 */
function DataFreshness({
  latestSalesDate,
  isShipmentError,
  computedAt,
  isProgressError,
}: {
  latestSalesDate: string | null
  isShipmentError: boolean
  computedAt: string | null
  isProgressError: boolean
}) {
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
