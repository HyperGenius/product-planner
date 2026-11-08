"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { TableCell, TableRow } from "@/components/ui/table"
import {
  ORDER_TABLE_COLUMN_COUNT,
  OrderTableHeaderRow,
  OrdersTable,
} from "@/components/orders/orders-table"
import { OrderTableRow, type OrderRowAction } from "@/components/orders/order-table-row"
import {
  INTAKE_PANEL_ID,
  intakeOwnerStyle,
} from "@/components/orders/intake/intake-category-summary"
import type { OrderActions } from "@/hooks/use-order-actions"
import type { OrderBulkActions } from "@/hooks/use-order-bulk-actions"
import { cn } from "@/lib/utils"
import {
  getProductName,
  groupOrdersByProduct,
  INTAKE_CATEGORY_META,
  isRepairOrder,
  type IntakeCategory,
} from "@/lib/order-utils"
import type { Customer } from "@/types/customer"
import type { MemberRole } from "@/types/member"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

/** 工程の登録待ちの見出し行から製品マスタを開けるロール（製品マスタで工程を登録する人） */
const ROUTING_EDITOR_ROLES: readonly MemberRole[] = ["president", "platform_admin"]

interface IntakeCategoryConfig {
  /** 「…」メニュー等に出す行の操作（ステータス・ロールの条件は `OrderTableRow` 側で別途かかる） */
  visibleActions: readonly OrderRowAction[]
  /** 一括操作（シミュ・承認依頼）の対象にするか */
  selectable: boolean
  /** 操作カラムの先頭に出す、その区分の次の操作 */
  leadingActions?: (order: Order, actions: OrderActions) => ReactNode
}

const editButton = (order: Order, actions: OrderActions) => (
  <Button size="sm" variant="outline" onClick={() => actions.handleOpenEditDialog(order)}>
    編集
  </Button>
)

const INTAKE_CATEGORY_CONFIG: Record<IntakeCategory, IntakeCategoryConfig> = {
  rejected: {
    // 差し戻し理由に応じて直し、依頼し直す。工程未入力の例外処理も他の区分と同じく残す
    visibleActions: [
      "request_approval",
      "simulate",
      "convert_to_repair",
      "ship_without_routing",
      "delete",
    ],
    selectable: false,
    leadingActions: editButton,
  },
  needs_input: {
    visibleActions: ["convert_to_repair", "ship_without_routing", "delete"],
    selectable: false,
    // 製品マスタに無い製品の登録も受注担当の作業
    leadingActions: (order, actions) =>
      !isRepairOrder(order) && order.product_id == null ? (
        <>
          <Button size="sm" variant="outline" onClick={() => actions.handleOpenEditDialog(order)}>
            製品を選ぶ
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/master/products">製品マスタに登録</Link>
          </Button>
        </>
      ) : (
        editButton(order, actions)
      ),
  },
  ready_to_request: {
    visibleActions: ["request_approval", "simulate", "edit", "convert_to_repair", "delete"],
    selectable: true,
  },
  waiting_routing: {
    // 工程の登録は製品の見出し行で案内する。行には例外処理（修理等への変換・工程未入力の送品）だけ残す
    visibleActions: ["edit", "convert_to_repair", "ship_without_routing", "delete"],
    selectable: false,
  },
}

interface IntakeCategorySectionProps {
  category: IntakeCategory
  orders: Order[]
  products?: Product[]
  customers?: Customer[]
  currentUserRole: MemberRole | null
  actions: OrderActions
  bulk: OrderBulkActions
}

/**
 * 「起票の確認」で選択中の区分の一覧（Issue #555 / #654）。列は共通で、操作を区分に合わせて絞る。
 * 工程の登録待ちは製品ごとの作業なので、製品の見出し行の下に注文を並べる
 */
export function IntakeCategorySection({
  category,
  orders,
  products,
  customers,
  currentUserRole,
  actions,
  bulk,
}: IntakeCategorySectionProps) {
  const meta = INTAKE_CATEGORY_META[category]
  const config = INTAKE_CATEGORY_CONFIG[category]
  const headingId = `${INTAKE_PANEL_ID}-heading`

  const selectAll = config.selectable ? (
    <Checkbox
      checked={bulk.getSelectAllState(orders)}
      onCheckedChange={() => bulk.handleToggleSelectAllOf(orders)}
      disabled={orders.length === 0 || bulk.isBulkOperationInProgress}
      aria-label={`${meta.label}をすべて選択`}
    />
  ) : undefined

  const renderRow = (order: Order) => (
    <OrderTableRow
      key={order.id}
      order={order}
      statusFilter="draft"
      products={products}
      customers={customers}
      currentUserRole={currentUserRole}
      visibleActions={config.visibleActions}
      selectable={config.selectable}
      showRejectionReason
      leadingActions={config.leadingActions?.(order, actions)}
      {...actions.getRowProps(order)}
      {...bulk.getRowProps(order)}
    />
  )

  const canOpenProductMaster =
    currentUserRole !== null && ROUTING_EDITOR_ROLES.includes(currentUserRole)

  const rows =
    category === "waiting_routing"
      ? groupOrdersByProduct(orders).map((group) => (
          <ProductGroupRows
            key={group.productId ?? "none"}
            productId={group.productId}
            productName={getProductName(group.productId, products)}
            orderCount={group.orders.length}
            canOpenProductMaster={canOpenProductMaster}
          >
            {group.orders.map(renderRow)}
          </ProductGroupRows>
        ))
      : orders.map(renderRow)

  return (
    <section
      id={INTAKE_PANEL_ID}
      aria-labelledby={headingId}
      className={cn("mb-8 border-t-4 pt-4", intakeOwnerStyle(category).stripe)}
    >
      <div className="mb-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {meta.label}
          <span className="ml-2 text-sm font-normal text-muted-foreground">{orders.length}件</span>
        </h2>
        <p className="text-sm text-muted-foreground">{meta.description}</p>
      </div>
      <OrdersTable
        isLoading={false}
        header={<OrderTableHeaderRow statusFilter="draft" selectAll={selectAll} />}
        rowCount={orders.length}
        emptyState={<p>該当する下書きはありません</p>}
      >
        {rows}
      </OrdersTable>
    </section>
  )
}

/** 工程の登録待ちの、製品の見出し行とその注文の行 */
function ProductGroupRows({
  productId,
  productName,
  orderCount,
  canOpenProductMaster,
  children,
}: {
  productId: number | null
  productName: string
  orderCount: number
  canOpenProductMaster: boolean
  children: ReactNode
}) {
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted/50">
        <TableCell colSpan={ORDER_TABLE_COLUMN_COUNT} className="py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {productName}
              <span className="ml-2 font-normal text-muted-foreground">注文 {orderCount}件</span>
            </span>
            {canOpenProductMaster && productId !== null ? (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/master/products?highlight=${productId}`}>製品マスタで工程を登録</Link>
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">社長の工程登録待ち</span>
            )}
          </div>
        </TableCell>
      </TableRow>
      {children}
    </>
  )
}
