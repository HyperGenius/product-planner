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
import { formatDateTimeShort } from "@/lib/order-utils"

type ShippingView = "candidates" | "all"

/**
 * 送品の消し込み（Issue #557）
 * URL: /orders/shipping
 *
 * 確定済・生産中の注文のうち、日報の進捗（最終工程の完了）と納期から送品済みになっていそうなものを
 * 候補として上に出す。送品の記録は弥生が正なので、自動では送品済みにせず、担当者が弥生で確認してから
 * 1件ずつ「送品済みにする」を押す。送品できるのは社長・受注担当で、それ以外のロールは閲覧のみ
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
  } = useOrdersShipping()
  const actions = useOrderActions(orders)
  const [view, setView] = useState<ShippingView>("candidates")
  const visibleRows = view === "candidates" ? candidateRows : rows
  const computedAtLabel = formatDateTimeShort(computedAt)

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">送品の消し込み</h1>
        <p className="text-muted-foreground mt-2">
          確定済・生産中の注文のうち、最終工程が完了した・納期を過ぎた・納期まで1週間を切った注文を候補として表示します
        </p>
      </div>

      <div
        role="note"
        className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          送品の記録は弥生が正です。弥生で送品を確認してから「送品済みにする」を押してください
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
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
    </div>
  )
}
