"use client"

import { useMemo } from "react"
import Link from "next/link"
import { FilePlus2 } from "lucide-react"
import { ScrollTable } from "@/components/scroll-table"
import { Button } from "@/components/ui/button"
import { TableCell, TableHead, TableRow } from "@/components/ui/table"
import {
  formatDeadlineShort,
  getCustomerDisplayName,
  getEffectiveOrderStatus,
  getProductName,
  getStatusLabel,
} from "@/lib/order-utils"
import { newOrderHrefForUnmatchedGroup } from "@/lib/shipping-worklist-utils"
import type { Customer } from "@/types/customer"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { ShipmentUnmatchedGroup } from "@/types/shipment"

/**
 * - register: ③受注を起票する。起票に要る、アプリの顧客・製品と備考の納期分を列に出し、行に「受注を起票する」を置く
 *   （行の値を初期値にして受注作成を開き、作成したら③へ戻る。#694）
 * - ambiguous: 送り先の受注を確かめる。弥生の備考と、見比べる受注（希望納期・顧客注文番号）を並べる
 */
export type UnmatchedEntriesVariant = "register" | "ambiguous"

interface UnmatchedShipmentEntriesProps {
  /** 出す行（`classifyShippingWorklist()` で振り分けた③または前提のまとまり） */
  items: readonly ShipmentUnmatchedGroup[]
  variant: UnmatchedEntriesVariant
  /** 行が無いときの表示 */
  emptyState: string
  isLoading: boolean
  isError: boolean
  orders: Order[] | undefined
  products: Product[] | undefined
  customers: Customer[] | undefined
}

/**
 * 送品の消し込みの、受注に結び付かない弥生の明細（Issue #682 / #692 / #693）。③受注を起票する・送り先の受注を確かめるの
 * ページで使う。行は得意先 × 商品コードのまとまり。抽出の期間やまとめ方はページのヘルプに書き、画面には書かない
 * （docs/ui-writing-guidelines.md）
 */
export function UnmatchedShipmentEntries({
  items,
  variant,
  emptyState,
  isLoading,
  isError,
  orders,
  products,
  customers,
}: UnmatchedShipmentEntriesProps) {
  const orderById = useMemo(() => new Map((orders ?? []).map((o) => [o.id, o])), [orders])

  return (
    <ScrollTable
      isLoading={isLoading}
      isError={isError}
      errorState="弥生の明細を取得できませんでした"
      rowCount={items.length}
      emptyState={emptyState}
      header={variant === "register" ? <RegisterHeaderRow /> : <AmbiguousHeaderRow />}
    >
      {items.map((item) => {
        const key = `${item.status}-${item.customer_code_key}-${item.product_code_key}`
        return variant === "register" ? (
          <RegisterRow key={key} item={item} products={products} customers={customers} />
        ) : (
          <AmbiguousRow key={key} item={item} orderById={orderById} />
        )
      })}
    </ScrollTable>
  )
}

// ---------------------------------------------------------------------------
// ③ 受注を起票する
// ---------------------------------------------------------------------------

function RegisterHeaderRow() {
  return (
    <TableRow>
      <TableHead>得意先（弥生）</TableHead>
      <TableHead>顧客</TableHead>
      <TableHead>品名</TableHead>
      <TableHead className="text-right">数量</TableHead>
      <TableHead>最後の売上日</TableHead>
      <TableHead>備考の納期分</TableHead>
      <TableHead className="text-right text-foreground">操作</TableHead>
    </TableRow>
  )
}

function RegisterRow({
  item,
  products,
  customers,
}: {
  item: ShipmentUnmatchedGroup
  products: Product[] | undefined
  customers: Customer[] | undefined
}) {
  const customerNames = item.customer_ids.map((id) => getCustomerDisplayName(id, customers))
  const productNames = item.product_ids.map((id) => getProductName(id, products))
  const deadlines = item.note_deadlines
    .map((d) => formatDeadlineShort(d))
    .filter((d): d is string => !!d)

  return (
    <TableRow data-testid="unmatched-shipment-row">
      <TableCell className="align-top">
        <YayoiName name={item.customer_name} code={item.customer_code} />
      </TableCell>
      <TableCell className="align-top">{customerNames.join("・") || "－"}</TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col leading-tight">
          <span>{productNames.join("・") || "－"}</span>
          <span className="text-xs text-muted-foreground">
            弥生 {item.product_code}
            {item.product_name && ` ${item.product_name}`}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right align-top">
        <QuantityCell item={item} />
      </TableCell>
      <TableCell className="align-top tabular-nums">
        {formatDeadlineShort(item.last_sales_date) ?? "－"}
      </TableCell>
      <TableCell className="align-top tabular-nums">
        {deadlines.length > 0 ? deadlines.join("・") : "－"}
      </TableCell>
      <TableCell className="text-right align-top">
        <Button asChild size="sm" variant="outline">
          <Link href={newOrderHrefForUnmatchedGroup(item)}>
            <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
            受注を起票する
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// 送り先の受注を確かめる
// ---------------------------------------------------------------------------

function AmbiguousHeaderRow() {
  return (
    <TableRow>
      <TableHead>得意先（弥生）</TableHead>
      <TableHead>商品（弥生）</TableHead>
      <TableHead className="text-right">数量</TableHead>
      <TableHead>最後の売上日</TableHead>
      <TableHead>弥生の備考</TableHead>
      <TableHead>見比べる受注</TableHead>
    </TableRow>
  )
}

function AmbiguousRow({
  item,
  orderById,
}: {
  item: ShipmentUnmatchedGroup
  orderById: Map<number, Order>
}) {
  const deadlines = item.note_deadlines
    .map((d) => formatDeadlineShort(d))
    .filter((d): d is string => !!d)

  return (
    <TableRow data-testid="unmatched-shipment-row">
      <TableCell className="align-top">
        <YayoiName name={item.customer_name} code={item.customer_code} />
      </TableCell>
      <TableCell className="align-top">
        <YayoiName name={item.product_name} code={item.product_code} />
      </TableCell>
      <TableCell className="text-right align-top">
        <QuantityCell item={item} />
      </TableCell>
      <TableCell className="align-top tabular-nums">
        {formatDeadlineShort(item.last_sales_date) ?? "－"}
      </TableCell>
      <TableCell className="align-top text-sm">
        <div className="flex flex-col gap-0.5">
          {deadlines.length > 0 && <span>納期分 {deadlines.join("・")}</span>}
          {item.latest_note && (
            <span className="text-xs text-muted-foreground">{item.latest_note}</span>
          )}
          {deadlines.length === 0 && !item.latest_note && (
            <span className="text-muted-foreground">－</span>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top text-sm">
        <ul className="flex flex-col gap-0.5">
          {item.candidate_order_ids.map((id) => (
            <li key={id}>
              <CompareOrderLink orderId={id} order={orderById.get(id)} />
            </li>
          ))}
        </ul>
      </TableCell>
    </TableRow>
  )
}

function CompareOrderLink({ orderId, order }: { orderId: number; order: Order | undefined }) {
  const label = order?.order_no ?? `#${orderId}`
  const details = order
    ? [
        `希望納期 ${formatDeadlineShort(order.desired_deadline) ?? "－"}`,
        order.customer_order_no ? `注番 ${order.customer_order_no}` : null,
        getStatusLabel(getEffectiveOrderStatus(order)),
      ]
        .filter(Boolean)
        .join("・")
    : null
  return (
    <span>
      <Link href={`/orders/${orderId}`} className="text-primary underline-offset-2 hover:underline">
        {label}
      </Link>
      {details && <span className="ml-1 text-xs text-muted-foreground">（{details}）</span>}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 共通のセル
// ---------------------------------------------------------------------------

function YayoiName({ name, code }: { name: string | null; code: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span>{name ?? "－"}</span>
      <span className="text-xs text-muted-foreground">{code}</span>
    </div>
  )
}

function QuantityCell({ item }: { item: ShipmentUnmatchedGroup }) {
  return (
    <div className="flex flex-col items-end leading-tight tabular-nums">
      <span>{item.total_qty.toLocaleString()}</span>
      <span className="text-xs text-muted-foreground">{item.entry_count}明細</span>
    </div>
  )
}
