"use client"

import { useMemo, useState } from "react"
import { Info } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  ShippingOrderHeaderRow,
  ShippingOrderRow,
} from "@/components/orders/shipping/shipping-order-row"
import { OrdersTable } from "@/components/orders/orders-table"
import { useOrderActions } from "@/hooks/use-order-actions"
import { useOrdersShipping } from "@/hooks/use-orders-shipping"
import Link from "next/link"
import { formatDateTimeShort, formatDeadlineShort } from "@/lib/order-utils"
import { ShipmentImportStatus } from "@/components/orders/shipping/shipment-import-status"
import {
  SHIPPING_CARD_STYLE,
  SHIPPING_PANEL_ID,
  ShippingReviewCards,
} from "@/components/orders/shipping/shipping-review-cards"
import { UnmatchedShipmentEntries } from "@/components/orders/shipping/unmatched-shipment-entries"
import { ShipmentOrderReviews } from "@/components/orders/shipping/shipment-order-reviews"
import { ListPageLayout } from "@/components/layout/list-page-layout"
import { useLocationHash } from "@/hooks/use-location-hash"
import { useShipmentOrderReviews, useShipmentUnmatchedEntries } from "@/hooks/use-shipments"
import {
  countOrderReviewGroups,
  countShippingReview,
  countUnmatchedGroups,
  toValidShippingCard,
  type ShippingReviewView,
} from "@/lib/shipping-review-utils"
import { cn } from "@/lib/utils"

type ShippingView = "candidates" | "all"

/**
 * 送品の消し込み（Issue #557 / #682）
 * URL: /orders/shipping
 *
 * カードは「送品の候補」と「要確認」で、選んだカードの詳細だけを出す（選択は URL のハッシュ）。
 *
 * - 送品の候補: 確定済・生産中の注文のうち、日報の進捗（最終工程の完了）と納期から送品済みになっていそうな
 *   ものを候補として上に出す。送品の記録は弥生が正なので、自動では送品済みにせず、担当者が弥生で確認してから
 *   1件ずつ「送品済みにする」を押す。送品できるのは社長・受注担当で、それ以外のロールは閲覧のみ
 * - 要確認: 受注に当たらない弥生の明細（起票漏れ・名寄せ漏れ・区別できない）と、弥生で送品済みなのに日報の進捗が
 *   追いついていない注文（工程なし・工程名の不一致・顧客先違い／作り置き・日報の漏れ。Issue #683）を原因ごとに出し、
 *   直す画面へ案内する。要確認の注文も「送品済みにする」は止めない（送品の候補の行に原因を短く出すだけ）
 */
export default function OrdersShippingPage() {
  const {
    orders,
    products,
    customers,
    isLoading,
    currentUserRole,
    rows,
    candidateRows,
    computedAt,
    isProgressError,
    latestSalesDate,
    isShipmentError,
  } = useOrdersShipping()
  const actions = useOrderActions(orders)
  const unmatched = useShipmentUnmatchedEntries()
  const orderReviews = useShipmentOrderReviews()
  const reviewByOrderId = useMemo(
    () => new Map((orderReviews.data?.items ?? []).map((r) => [r.order_id, r])),
    [orderReviews.data],
  )
  const unmatchedCount = countUnmatchedGroups(unmatched.data)
  const orderReviewCount = countOrderReviewGroups(orderReviews.data)
  // 片方の取得中に途中の件数を出さない。取得に失敗した方は除いて数える
  const reviewCount =
    unmatched.isLoading || orderReviews.isLoading
      ? null
      : countShippingReview(unmatchedCount, orderReviewCount)
  // 要確認の中の切り替え。選ぶまでは、日報が追いついていない注文があればそちらを出す
  const [reviewView, setReviewView] = useState<ShippingReviewView | null>(null)
  const activeReviewView: ShippingReviewView =
    reviewView ?? ((orderReviewCount ?? 0) > 0 ? "orders" : "entries")
  const [hash, setHash] = useLocationHash()
  const card = toValidShippingCard(hash)
  const [view, setView] = useState<ShippingView>("candidates")
  const visibleRows = view === "candidates" ? candidateRows : rows
  const computedAtLabel = formatDateTimeShort(computedAt)

  return (
    <ListPageLayout
      title="送品の消し込み"
      description="弥生で送品が確認できた・最終工程が完了した・納期を過ぎた・納期まで1週間を切った注文を送品の候補に、受注に当たらない弥生の明細と日報の進捗が追いついていない注文を要確認に表示します"
    >
      <div
        role="note"
        className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          送品の記録は弥生が正です。弥生で送品を確認してから「送品済みにする」を押してください。
          「弥生の送品」は取り込んだ売上明細を受注に当てた数量で、自動では送品済みにしません
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <ShipmentImportStatus />
        <p className="text-xs text-muted-foreground">
          {isShipmentError
            ? "弥生の売上明細を取得できませんでした"
            : latestSalesDate
              ? `弥生の売上明細: ${formatDeadlineShort(latestSalesDate)} 売上分まで`
              : "弥生の売上明細はまだ解析されていません"}
          {" · "}
          <Link href="/orders/shipment-names" className="underline hover:text-foreground">
            弥生の名寄せ
          </Link>
        </p>
      </div>

      <ShippingReviewCards
        candidateCount={isLoading ? null : candidateRows.length}
        reviewCount={reviewCount}
        selected={card}
        onSelect={setHash}
      />

      {/* 選択中のカード以外の詳細は出さない */}
      <div
        id={SHIPPING_PANEL_ID}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-3 border-t-4 pt-3",
          SHIPPING_CARD_STYLE[card].stripe,
        )}
      >
        {card === "candidates" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs value={view} onValueChange={(v) => setView(v as ShippingView)}>
                <TabsList>
                  <TabsTrigger value="candidates">候補のみ（{candidateRows.length}）</TabsTrigger>
                  <TabsTrigger value="all">すべて（{rows.length}）</TabsTrigger>
                </TabsList>
              </Tabs>
              <p className="text-xs text-muted-foreground">
                {isProgressError
                  ? "日報の進捗を取得できませんでした（納期だけで判定しています）"
                  : computedAtLabel
                    ? `日報の進捗: ${computedAtLabel} 時点`
                    : "日報の進捗はまだ集計されていません"}
              </p>
            </div>

            <OrdersTable
              fill
              isLoading={isLoading}
              header={<ShippingOrderHeaderRow />}
              rowCount={visibleRows.length}
              emptyState={
                <p>
                  {view === "candidates"
                    ? "送品済みにする候補の注文はありません"
                    : "確定済・生産中の注文はありません"}
                </p>
              }
            >
              {visibleRows.map((row) => (
                <ShippingOrderRow
                  key={row.order.id}
                  row={row}
                  products={products}
                  customers={customers}
                  currentUserRole={currentUserRole}
                  review={reviewByOrderId.get(row.order.id)}
                  {...actions.getRowProps(row.order)}
                />
              ))}
            </OrdersTable>
          </>
        ) : (
          <>
            <Tabs
              value={activeReviewView}
              onValueChange={(v) => setReviewView(v as ShippingReviewView)}
            >
              <TabsList>
                <TabsTrigger value="orders">
                  日報が追いついていない注文（{orderReviewCount ?? "－"}）
                </TabsTrigger>
                <TabsTrigger value="entries">
                  受注に当たらない弥生の明細（{unmatchedCount ?? "－"}）
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {activeReviewView === "orders" ? (
              <ShipmentOrderReviews
                data={orderReviews.data}
                isLoading={orderReviews.isLoading}
                isError={orderReviews.isError}
                orders={orders}
                products={products}
                customers={customers}
              />
            ) : (
              <UnmatchedShipmentEntries
                data={unmatched.data}
                isLoading={unmatched.isLoading}
                isError={unmatched.isError}
                orders={orders}
                products={products}
                customers={customers}
              />
            )}
          </>
        )}
      </div>
    </ListPageLayout>
  )
}
