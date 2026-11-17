"use client"

import { useState } from "react"
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
import { ListPageLayout } from "@/components/layout/list-page-layout"
import { useLocationHash } from "@/hooks/use-location-hash"
import { useShipmentUnmatchedEntries } from "@/hooks/use-shipments"
import { countUnmatchedGroups, toValidShippingCard } from "@/lib/shipping-review-utils"
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
 * - 要確認: 受注に当たらない弥生の明細（起票漏れ・名寄せ漏れ・区別できない）を原因ごとに出し、直す画面へ案内する
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
  const [hash, setHash] = useLocationHash()
  const card = toValidShippingCard(hash)
  const [view, setView] = useState<ShippingView>("candidates")
  const visibleRows = view === "candidates" ? candidateRows : rows
  const computedAtLabel = formatDateTimeShort(computedAt)

  return (
    <ListPageLayout
      title="送品の消し込み"
      description="弥生で送品が確認できた・最終工程が完了した・納期を過ぎた・納期まで1週間を切った注文を送品の候補に、受注に当たらない弥生の明細を要確認に表示します"
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
        reviewCount={countUnmatchedGroups(unmatched.data)}
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
                  {...actions.getRowProps(row.order)}
                />
              ))}
            </OrdersTable>
          </>
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
      </div>
    </ListPageLayout>
  )
}
