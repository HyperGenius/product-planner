"use client"

import Link from "next/link"
import { Truck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableCell, TableHead, TableRow } from "@/components/ui/table"
import type { OrderRowActionProps } from "@/hooks/use-order-actions"
import { STATUS_CLASS } from "@/lib/floor-dashboard-utils"
import {
  canShipOrder,
  formatDeadlineDate,
  formatDeadlineShort,
  getCustomerDisplayName,
  getOrderProductDisplayParts,
  isRepairOrder,
  ORDER_TYPE_LABELS,
} from "@/lib/order-utils"
import type { ShippingRow } from "@/lib/shipping-candidate-utils"
import { ORDER_REVIEW_CAUSE_META, shippingPageHref } from "@/lib/shipping-review-utils"
import { isAwaitingYayoiImport, type ShippingWorklistOrder } from "@/lib/shipping-worklist-utils"
import type { Customer } from "@/types/customer"
import type { MemberRole } from "@/types/member"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

/**
 * 送品の消し込みの①送品済みにする・②出荷を確かめるの行（Issue #557 / #692 / #693）。
 * 1ページで扱う行動は1種類なので、列はページごとの行動に要るものだけにする（Epic #690）。
 * 行に出すのは判断が変わる例外の印だけ（一部送品・送り先未定・日報の漏れ・取り込み待ち。docs/ui-writing-guidelines.md 4.4）
 */

interface OrderRowBaseProps {
  row: ShippingWorklistOrder
  products?: Product[]
  customers?: Customer[]
}

// ---------------------------------------------------------------------------
// ① 送品済みにする
// ---------------------------------------------------------------------------

/** ①の見出しの行。理由の列は出さない（全行が「弥生で出荷済み」で、一覧に入っている理由そのものなので） */
export function ShipOrderHeaderRow() {
  return (
    <TableRow>
      <TableHead>注文番号</TableHead>
      <TableHead>顧客</TableHead>
      <TableHead>品名</TableHead>
      <TableHead className="text-right">受注数量</TableHead>
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>弥生の送品</span>
          <span className="text-xs font-normal text-muted-foreground">数量／最後の売上日</span>
        </div>
      </TableHead>
      <TableHead>納期</TableHead>
      <TableHead className="text-right text-foreground">操作</TableHead>
    </TableRow>
  )
}

interface ShipOrderRowProps extends OrderRowBaseProps, OrderRowActionProps {
  currentUserRole: MemberRole | null
}

/**
 * ①の行。社長・受注担当に「送品済みにする」を出し、それ以外のロールは閲覧のみ（`canShipOrder()`）。
 * 日報が未入力でも送品済みにする操作は止めない。一括の送品は作らない（弥生で1件ずつ確認する運用のため）
 */
export function ShipOrderRow({
  row,
  products,
  customers,
  currentUserRole,
  shipIsPending,
  onShip,
}: ShipOrderRowProps) {
  const { order } = row
  const canShip = canShipOrder(order, currentUserRole)
  return (
    <TableRow>
      <TableCell>
        <OrderNoCell row={row} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <CustomerName order={order} customers={customers} />
      </TableCell>
      <TableCell>
        <ProductName order={order} products={products} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {order.quantity != null ? order.quantity.toLocaleString("ja-JP") : "-"}
      </TableCell>
      <TableCell>
        <ShipmentCell shipment={row.shipment} />
      </TableCell>
      <TableCell>
        <DeadlineCell row={row} showDays />
      </TableCell>
      <TableCell className="text-right">
        {canShip && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onShip(order.id, String(order.order_no ?? order.id))}
            disabled={shipIsPending}
          >
            <Truck className="mr-1.5 h-3.5 w-3.5" />
            送品済みにする
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// ② 出荷を確かめる
// ---------------------------------------------------------------------------

/** ②の見出しの行。弥生でまだ確かめられていないので、操作の列は置かない（送品済みにしない） */
export function ConfirmOrderHeaderRow() {
  return (
    <TableRow>
      <TableHead>注文番号</TableHead>
      <TableHead>顧客</TableHead>
      <TableHead>品名</TableHead>
      <TableHead>理由</TableHead>
      <TableHead>
        <div className="flex flex-col leading-tight">
          <span>弥生の送品</span>
          <span className="text-xs font-normal text-muted-foreground">数量／最後の売上日</span>
        </div>
      </TableHead>
      <TableHead>工程の進捗</TableHead>
      <TableHead>納期</TableHead>
    </TableRow>
  )
}

interface ConfirmOrderRowProps extends OrderRowBaseProps {
  /** 取り込んだ弥生の明細の最新の売上日（取り込み待ちの判定に使う） */
  latestSalesDate: string | null
}

/** ②の行。理由（最終工程が完了・納期を過ぎた・納期まで n日）は行ごとに違うので出す */
export function ConfirmOrderRow({ row, products, customers, latestSalesDate }: ConfirmOrderRowProps) {
  const { order, progress } = row
  return (
    <TableRow>
      <TableCell>
        <OrderNoCell row={row} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        <CustomerName order={order} customers={customers} />
      </TableCell>
      <TableCell>
        <ProductName order={order} products={products} />
      </TableCell>
      <TableCell>
        <ConfirmReasons row={row} />
      </TableCell>
      <TableCell>
        <ShipmentCell
          shipment={row.shipment}
          notRecorded={isAwaitingYayoiImport(row, latestSalesDate) ? "awaiting" : "missing"}
        />
      </TableCell>
      <TableCell className="text-sm tabular-nums">
        {progress ? (
          <span>
            {progress.completedCount} / {progress.totalCount}
            <span className="ml-1 text-xs text-muted-foreground">工程</span>
          </span>
        ) : (
          <span className="text-muted-foreground">日報なし</span>
        )}
      </TableCell>
      <TableCell>
        <DeadlineCell row={row} />
      </TableCell>
    </TableRow>
  )
}

/** ②の理由。納期の理由は納期の状態と同じ色（過ぎた＝赤、間近＝amber）にする */
function ConfirmReasons({ row }: { row: ShippingRow }) {
  const { reasons, daysRemaining } = row
  const badges: { key: string; label: string; className: string }[] = []
  if (reasons.includes("final_process_completed")) {
    badges.push({
      key: "final",
      label: "最終工程が完了",
      className: "bg-green-100 text-green-800 hover:bg-green-100",
    })
  }
  if (reasons.includes("overdue") && daysRemaining !== null) {
    badges.push({
      key: "overdue",
      label: `納期を${-daysRemaining}日過ぎた`,
      className: STATUS_CLASS.overdue,
    })
  }
  if (reasons.includes("due_soon") && daysRemaining !== null) {
    badges.push({
      key: "due_soon",
      label: daysRemaining === 0 ? "納期は今日" : `納期まで${daysRemaining}日`,
      className: STATUS_CLASS.due_soon,
    })
  }
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <Badge key={b.key} className={b.className}>
          {b.label}
        </Badge>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 共通のセル
// ---------------------------------------------------------------------------

/** 注文番号と、日報が未入力のときの印（日報の参考のページへ） */
function OrderNoCell({ row }: { row: ShippingWorklistOrder }) {
  const { order } = row
  const review = row.marks.dailyReport
  return (
    <div className="flex flex-col items-start gap-0.5 leading-tight">
      <Link href={`/orders/${order.id}`} className="font-medium hover:underline">
        {order.order_no ?? order.id}
      </Link>
      {review && (
        <Link
          href={shippingPageHref("daily-reports")}
          className="text-xs font-medium text-amber-700 underline-offset-2 hover:underline"
        >
          日報: {ORDER_REVIEW_CAUSE_META[review.cause].short}
        </Link>
      )}
    </div>
  )
}

function CustomerName({ order, customers }: { order: Order; customers?: Customer[] }) {
  return <>{order.customer_id == null ? "-" : getCustomerDisplayName(order.customer_id, customers)}</>
}

function ProductName({ order, products }: { order: Order; products?: Product[] }) {
  const product = getOrderProductDisplayParts(order, products)
  return (
    <div className="flex flex-col leading-tight">
      <span className="inline-flex items-center gap-1.5 text-sm">
        {isRepairOrder(order) && (
          <Badge className="shrink-0 bg-slate-100 text-slate-700 hover:bg-slate-100">
            {ORDER_TYPE_LABELS.repair}
          </Badge>
        )}
        {product.primary}
      </span>
      {product.secondary && (
        <span className="text-xs text-muted-foreground">{product.secondary}</span>
      )}
    </div>
  )
}

function DaysRemainingLabel({ days }: { days: number }) {
  if (days < 0) {
    return <span className="text-xs font-semibold text-destructive">{-days}日超過</span>
  }
  if (days === 0) return <span className="text-xs font-semibold text-amber-600">今日</span>
  return <span className="text-xs text-muted-foreground">残り{days}日</span>
}

/**
 * 納期（希望納期、無ければ完成見込み）。②は理由に超過・残りの日数を出すので、ここでは日数を繰り返さない
 */
function DeadlineCell({ row, showDays = false }: { row: ShippingRow; showDays?: boolean }) {
  const { deadline, deadlineSource, daysRemaining } = row
  return (
    <div className="flex flex-col items-start gap-0.5 leading-tight text-sm">
      <span title={formatDeadlineDate(deadline) ?? undefined}>
        {formatDeadlineShort(deadline) ?? "-"}
        {deadlineSource === "effective" && (
          <span className="ml-1 text-xs text-muted-foreground">（完成見込み）</span>
        )}
      </span>
      {showDays && daysRemaining !== null && <DaysRemainingLabel days={daysRemaining} />}
    </div>
  )
}

/**
 * 弥生の売上明細で送品が確認できた数量（分納を合算）と最後の売上日（Issue #667）。
 * 受注数量に届かない間は「一部送品」。送り先の受注を決められない明細は件数だけを出し、確かめるページへつなぐ。
 *
 * @param notRecorded 弥生に1明細も無いときの出し方（②）。`awaiting` は取り込み待ち、`missing` は未計上。
 *   省略時（①）は「-」
 */
export function ShipmentCell({
  shipment,
  notRecorded,
}: {
  shipment: ShippingRow["shipment"]
  notRecorded?: "awaiting" | "missing"
}) {
  const hasEntries = !!shipment && shipment.entries.length > 0
  const ambiguousCount = shipment?.ambiguous_entries.length ?? 0
  const entryTitle = shipment?.entries
    .map((e) => `${e.sales_date} ${e.quantity ?? "-"}${e.note ? `（${e.note}）` : ""}`)
    .join("\n")
  return (
    <div className="flex flex-col items-start gap-0.5 leading-tight text-sm">
      {hasEntries ? (
        <span className="tabular-nums" title={entryTitle || undefined}>
          {shipment.shipped_qty.toLocaleString("ja-JP")}
          {shipment.order_quantity != null && (
            <span className="text-muted-foreground">
              {" "}
              / {shipment.order_quantity.toLocaleString("ja-JP")}
            </span>
          )}
          {!shipment.is_fully_shipped && (
            <Badge className="ml-1.5 bg-amber-100 text-[10px] text-amber-800 hover:bg-amber-100">
              一部送品
            </Badge>
          )}
        </span>
      ) : notRecorded === "awaiting" ? (
        <span className="text-muted-foreground">取り込み待ち</span>
      ) : notRecorded === "missing" ? (
        <span className="font-medium text-amber-700">未計上</span>
      ) : (
        <span className="text-muted-foreground">-</span>
      )}
      {hasEntries && shipment.last_sales_date && (
        <span className="text-xs text-muted-foreground">
          {formatDeadlineShort(shipment.last_sales_date)} 売上
        </span>
      )}
      {ambiguousCount > 0 && (
        <Link
          href={shippingPageHref("ambiguous")}
          className="text-xs text-amber-700 underline-offset-2 hover:underline"
        >
          送り先未定 {ambiguousCount}明細
        </Link>
      )}
    </div>
  )
}
