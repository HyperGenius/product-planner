"use client"

import { Fragment, useMemo } from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { ScrollTable } from "@/components/scroll-table"
import { TableCell, TableHead, TableRow } from "@/components/ui/table"
import {
  formatDeadlineShort,
  getCustomerDisplayName,
  getEffectiveOrderStatus,
  getProductName,
  getStatusLabel,
} from "@/lib/order-utils"
import {
  UNMATCHED_STATUSES,
  UNMATCHED_STATUS_META,
  groupUnmatchedByStatus,
} from "@/lib/shipping-review-utils"
import type { Customer } from "@/types/customer"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { ShipmentUnmatchedGroup, ShipmentUnmatchedList } from "@/types/shipment"

/** 列の数。原因の見出し行の `colSpan` に使う（列を増減したら合わせる） */
const COLUMN_COUNT = 6

interface UnmatchedShipmentEntriesProps {
  /** `GET /shipments/unmatched-entries` の期間など（行は `items` を使う） */
  data: ShipmentUnmatchedList | undefined
  /** 出す行（`classifyShippingWorklist()` で振り分けた③または前提のまとまり） */
  items: readonly ShipmentUnmatchedGroup[]
  /** 行が無いときの表示 */
  emptyState: string
  isLoading: boolean
  isError: boolean
  orders: Order[] | undefined
  products: Product[] | undefined
  customers: Customer[] | undefined
}

/**
 * 送品の消し込みの、受注に結び付かない弥生の明細（Issue #682 / #692）。③受注を起票する・前提の送品先の受注を見分けるで使う。
 * 原因ごとの見出しの下に得意先 × 商品コードでまとめて出し、見出しに直す画面へのリンクを1回だけ置く。
 * 送品の記録は弥生が正なので、ここから送品済みにはしない
 */
export function UnmatchedShipmentEntries({
  data,
  items,
  emptyState,
  isLoading,
  isError,
  orders,
  products,
  customers,
}: UnmatchedShipmentEntriesProps) {
  const grouped = useMemo(() => groupUnmatchedByStatus(items), [items])
  const orderById = useMemo(() => new Map((orders ?? []).map((o) => [o.id, o])), [orders])

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {data?.since && data.latest_sales_date
          ? `対象: 弥生の売上日 ${formatDeadlineShort(data.since)}〜${formatDeadlineShort(data.latest_sales_date)}（取り込んだ明細の直近60日）。`
          : ""}
        得意先・商品コードごとにまとめています。弥生の表記は最新の明細の値です
        {data?.truncated && "。件数が多いため一部だけを表示しています"}
      </p>
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
          </TableRow>
        }
      >
        {UNMATCHED_STATUSES.map((status) => {
          const rows = grouped[status]
          if (rows.length === 0) return null
          const meta = UNMATCHED_STATUS_META[status]
          return (
            <Fragment key={status}>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={COLUMN_COUNT} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">
                        {meta.label}
                        <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                          {rows.length}商品
                        </span>
                      </h3>
                      <p className="text-xs text-muted-foreground">{meta.hint}</p>
                    </div>
                    {meta.action && (
                      <Link
                        href={meta.action.href}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        {meta.action.label}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              {rows.map((item) => (
                <UnmatchedRow
                  key={`${item.status}-${item.customer_code_key}-${item.product_code_key}`}
                  item={item}
                  orderById={orderById}
                  products={products}
                  customers={customers}
                />
              ))}
            </Fragment>
          )
        })}
      </ScrollTable>
    </>
  )
}

function UnmatchedRow({
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
      <TableCell className="text-right align-top tabular-nums">{item.entry_count}件</TableCell>
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
