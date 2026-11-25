"use client"

import { Fragment, useMemo, useState } from "react"
import Link from "next/link"
import { ArrowRight, ChevronDown, ChevronRight } from "lucide-react"
import { ScrollTable } from "@/components/scroll-table"
import { Button } from "@/components/ui/button"
import { TableCell, TableHead, TableRow } from "@/components/ui/table"
import {
  formatDeadlineShort,
  getCustomerDisplayName,
  getProductName,
} from "@/lib/order-utils"
import {
  ORDER_REVIEW_CAUSES,
  ORDER_REVIEW_CAUSE_META,
  groupOrderReviews,
  type OrderReviewProductGroup,
} from "@/lib/shipping-review-utils"
import type { Customer } from "@/types/customer"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type {
  ShipmentOrderReview,
  ShipmentOrderReviewCause,
  ShipmentOrderReviewList,
} from "@/types/shipment"

/** 列の数。原因の見出し行・受注の一覧の `colSpan` に使う（列を増減したら合わせる） */
const COLUMN_COUNT = 5

interface ShipmentOrderReviewsProps {
  data: ShipmentOrderReviewList | undefined
  isLoading: boolean
  isError: boolean
  orders: Order[] | undefined
  products: Product[] | undefined
  customers: Customer[] | undefined
}

/**
 * 送品の消し込みの参考「日報が未入力の出荷済み注文」（Issue #683 / #692）。弥生の送品数量が、日報で追う最後の工程の良品数を
 * 超えている注文を、原因ごとの見出しの下に製品の単位でまとめ、受注の一覧は展開で見せる。直す画面は見出しに1回だけ置く。
 * 原因の説明・対象の条件はページのヘルプに書き、画面には書かない（docs/ui-writing-guidelines.md）
 */
export function ShipmentOrderReviews({
  data,
  isLoading,
  isError,
  orders,
  products,
  customers,
}: ShipmentOrderReviewsProps) {
  const grouped = useMemo(() => groupOrderReviews(data?.items ?? []), [data])
  const orderById = useMemo(() => new Map((orders ?? []).map((o) => [o.id, o])), [orders])

  return (
    <>
      <ScrollTable
        isLoading={isLoading}
        isError={isError}
        errorState="日報が未入力の出荷済み注文を取得できませんでした"
        rowCount={data?.items.length ?? 0}
        emptyState="日報が未入力の出荷済み注文はありません"
        header={
          <TableRow>
            <TableHead>製品</TableHead>
            <TableHead>注文</TableHead>
            <TableHead className="text-right">弥生の送品</TableHead>
            <TableHead className="text-right">最終工程の良品</TableHead>
            <TableHead>手がかり</TableHead>
          </TableRow>
        }
      >
        {ORDER_REVIEW_CAUSES.map((cause) => {
          const groups = grouped[cause]
          if (groups.length === 0) return null
          return (
            <Fragment key={cause}>
              <CauseHeadingRow cause={cause} productCount={groups.length} />
              {groups.map((group) => (
                <ProductGroupRows
                  key={`${cause}-${group.productId}`}
                  cause={cause}
                  group={group}
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

function CauseHeadingRow({
  cause,
  productCount,
}: {
  cause: ShipmentOrderReviewCause
  productCount: number
}) {
  const meta = ORDER_REVIEW_CAUSE_META[cause]
  return (
    <TableRow className="bg-muted/50 hover:bg-muted/50">
      <TableCell colSpan={COLUMN_COUNT} className="py-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">
              {meta.label}
              <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                {productCount}製品
              </span>
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                担当: {meta.owner ?? "現場に確認"}
              </span>
            </h3>
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
  )
}

function ProductGroupRows({
  cause,
  group,
  orderById,
  products,
  customers,
}: {
  cause: ShipmentOrderReviewCause
  group: OrderReviewProductGroup
  orderById: Map<number, Order>
  products: Product[] | undefined
  customers: Customer[] | undefined
}) {
  const [open, setOpen] = useState(false)
  const productName = getProductName(group.productId, products)
  const processNames = Array.from(new Set(group.reviews.flatMap((r) => r.process_names)))
  const unallocatedQty = group.reviews.reduce((sum, r) => sum + r.unallocated_qty, 0)
  const finalProcess = group.reviews[0]?.final_process_name ?? null

  return (
    <>
      <TableRow data-testid="order-review-product-row">
        <TableCell className="align-top">
          <div className="flex flex-col items-start leading-tight">
            <span>{productName}</span>
            {(cause === "no_routing" || cause === "process_mismatch") && (
              <Link
                href={`/master/products?highlight=${group.productId}`}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                製品マスタで工程を開く
              </Link>
            )}
          </div>
        </TableCell>
        <TableCell className="align-top">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-7 px-2"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <ChevronDown className="mr-1 h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="mr-1 h-3.5 w-3.5" />
            )}
            {group.reviews.length}件の注文
          </Button>
        </TableCell>
        <TableCell className="text-right align-top tabular-nums">
          {group.shippedQty.toLocaleString("ja-JP")}
        </TableCell>
        <TableCell className="text-right align-top tabular-nums">
          {finalProcess === null ? (
            <span className="text-muted-foreground">工程なし</span>
          ) : (
            <span>
              {group.finalGoodQty.toLocaleString("ja-JP")}
              <span className="ml-1 text-xs text-muted-foreground">（{finalProcess}）</span>
            </span>
          )}
        </TableCell>
        <TableCell className="align-top text-sm">
          <Evidence cause={cause} processNames={processNames} unallocatedQty={unallocatedQty} />
        </TableCell>
      </TableRow>
      {open &&
        group.reviews.map((review) => (
          <OrderReviewRow
            key={review.order_id}
            review={review}
            order={orderById.get(review.order_id)}
            customers={customers}
            showStockLink={cause === "customer_or_stock"}
          />
        ))}
    </>
  )
}

function Evidence({
  cause,
  processNames,
  unallocatedQty,
}: {
  cause: ShipmentOrderReviewCause
  processNames: string[]
  unallocatedQty: number
}) {
  if (cause === "process_mismatch") {
    return (
      <span>
        <span className="text-muted-foreground">工程ルートに無い日報の工程: </span>
        {processNames.join("・") || "－"}
        <span className="ml-1 text-xs text-muted-foreground tabular-nums">
          （{unallocatedQty.toLocaleString("ja-JP")}個）
        </span>
      </span>
    )
  }
  if (cause === "customer_or_stock") {
    return (
      <span>
        <span className="text-muted-foreground">割り付けられずに残っている実績: </span>
        <span className="tabular-nums">{unallocatedQty.toLocaleString("ja-JP")}個</span>
        {processNames.length > 0 && (
          <span className="ml-1 text-xs text-muted-foreground">（{processNames.join("・")}）</span>
        )}
      </span>
    )
  }
  return <span className="text-muted-foreground">－</span>
}

function OrderReviewRow({
  review,
  order,
  customers,
  showStockLink,
}: {
  review: ShipmentOrderReview
  order: Order | undefined
  customers: Customer[] | undefined
  showStockLink: boolean
}) {
  const customer =
    order?.customer_id == null ? null : getCustomerDisplayName(order.customer_id, customers)
  return (
    <TableRow data-testid="order-review-order-row" className="bg-muted/20">
      <TableCell className="pl-8 align-top text-sm text-muted-foreground">
        {customer ?? "－"}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col items-start leading-tight">
          <Link href={`/orders/${review.order_id}`} className="font-medium hover:underline">
            {order?.order_no ?? review.order_id}
          </Link>
          <span className="text-xs text-muted-foreground">
            {formatDeadlineShort(review.last_sales_date) ?? "－"} 売上
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">
        {review.shipped_qty.toLocaleString("ja-JP")}
        {order?.quantity != null && (
          <span className="text-muted-foreground"> / {order.quantity.toLocaleString("ja-JP")}</span>
        )}
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">
        {review.final_process_name === null ? "－" : review.final_good_qty.toLocaleString("ja-JP")}
      </TableCell>
      <TableCell className="align-top text-sm">
        {showStockLink && (
          <Link
            href={`/orders/${review.order_id}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            受注詳細で作り置きを引き当てる
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </TableCell>
    </TableRow>
  )
}
