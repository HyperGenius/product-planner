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
import type { Customer } from "@/types/customer"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { ShipmentUnmatchedGroup } from "@/types/shipment"

interface UnmatchedShipmentEntriesProps {
  /** 出す行（`classifyShippingWorklist()` で振り分けた③または前提のまとまり） */
  items: readonly ShipmentUnmatchedGroup[]
  /** 行が無いときの表示 */
  emptyState: string
  /** 行の操作。③では「受注を起票する」を出す（受注作成画面へ。初期値の受け渡しは #694） */
  rowAction?: "register"
  isLoading: boolean
  isError: boolean
  orders: Order[] | undefined
  products: Product[] | undefined
  customers: Customer[] | undefined
}

/**
 * 送品の消し込みの、受注に結び付かない弥生の明細（Issue #682 / #692）。③受注を起票する・送り先の受注を確かめるで使う。
 * 行は得意先 × 商品コードのまとまり。抽出の期間やまとめ方はページのヘルプに書き、画面には書かない
 * （docs/ui-writing-guidelines.md）
 */
export function UnmatchedShipmentEntries({
  items,
  emptyState,
  rowAction,
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
      header={
        <TableRow>
          <TableHead>得意先（弥生）</TableHead>
          <TableHead>商品（弥生）</TableHead>
          <TableHead className="text-right">明細</TableHead>
          <TableHead className="text-right">数量</TableHead>
          <TableHead>最新の売上日</TableHead>
          <TableHead>手がかり</TableHead>
          {rowAction && <TableHead className="text-right text-foreground">操作</TableHead>}
        </TableRow>
      }
    >
      {items.map((item) => (
        <UnmatchedRow
          key={`${item.status}-${item.customer_code_key}-${item.product_code_key}`}
          item={item}
          rowAction={rowAction}
          orderById={orderById}
          products={products}
          customers={customers}
        />
      ))}
    </ScrollTable>
  )
}

function UnmatchedRow({
  item,
  rowAction,
  orderById,
  products,
  customers,
}: {
  item: ShipmentUnmatchedGroup
  rowAction?: "register"
  orderById: Map<number, Order>
  products: Product[] | undefined
  customers: Customer[] | undefined
}) {
  return (
    <TableRow data-testid="unmatched-shipment-row">
      <TableCell className="align-top">
        <div className="flex flex-col leading-tight">
          <span>{item.customer_name ?? "－"}</span>
          <span className="text-xs text-muted-foreground">{item.customer_code}</span>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col leading-tight">
          <span>{item.product_name ?? "－"}</span>
          <span className="text-xs text-muted-foreground">{item.product_code}</span>
        </div>
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">{item.entry_count}明細</TableCell>
      <TableCell className="text-right align-top tabular-nums">
        {item.total_qty.toLocaleString()}
      </TableCell>
      <TableCell className="align-top tabular-nums">
        {formatDeadlineShort(item.last_sales_date) ?? "－"}
      </TableCell>
      <TableCell className="align-top text-sm">
        <MatchedDetail
          item={item}
          orderById={orderById}
          products={products}
          customers={customers}
        />
      </TableCell>
      {rowAction === "register" && (
        <TableCell className="text-right align-top">
          <Button asChild size="sm" variant="outline">
            <Link href="/orders/new">
              <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
              受注を起票する
            </Link>
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

function MatchedDetail({
  item,
  orderById,
  products,
  customers,
}: {
  item: ShipmentUnmatchedGroup
  orderById: Map<number, Order>
  products: Product[] | undefined
  customers: Customer[] | undefined
}) {
  const customerNames = item.customer_ids
    .map((id) => getCustomerDisplayName(id, customers))
    .join("・")
  const productNames = item.product_ids.map((id) => getProductName(id, products)).join("・")
  const deadlines = item.note_deadlines
    .map((d) => formatDeadlineShort(d))
    .filter(Boolean)
    .join("・")

  return (
    <div className="flex flex-col gap-0.5">
      {customerNames && (
        <span>
          <span className="text-muted-foreground">顧客: </span>
          {customerNames}
        </span>
      )}
      {productNames && (
        <span>
          <span className="text-muted-foreground">製品: </span>
          {productNames}
        </span>
      )}
      {deadlines && (
        <span>
          <span className="text-muted-foreground">備考の納期分: </span>
          {deadlines}
        </span>
      )}
      {item.status === "ambiguous" && item.candidate_order_ids.length > 0 && (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground">見比べる受注:</span>
          {item.candidate_order_ids.map((id) => (
            <CandidateOrderLink key={id} orderId={id} order={orderById.get(id)} />
          ))}
        </span>
      )}
      {!deadlines && item.latest_note && (
        <span className="text-xs text-muted-foreground">備考: {item.latest_note}</span>
      )}
      {!customerNames && !productNames && !deadlines && !item.latest_note && (
        <span className="text-muted-foreground">－</span>
      )}
    </div>
  )
}

function CandidateOrderLink({ orderId, order }: { orderId: number; order: Order | undefined }) {
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
