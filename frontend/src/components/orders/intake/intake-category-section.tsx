"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { OrderTableHeaderRow, OrdersTable } from "@/components/orders/orders-table"
import { OrderTableRow, type OrderRowAction } from "@/components/orders/order-table-row"
import { intakeSectionId } from "@/components/orders/intake/intake-category-summary"
import type { OrderActions } from "@/hooks/use-order-actions"
import type { OrderBulkActions } from "@/hooks/use-order-bulk-actions"
import { cn } from "@/lib/utils"
import { INTAKE_CATEGORY_META, type IntakeCategory } from "@/lib/order-utils"
import type { Customer } from "@/types/customer"
import type { Order } from "@/types/order"
import type { Product } from "@/types/product"

interface IntakeCategoryConfig {
  /** 「…」メニュー等に出す行の操作（ステータス・ロールの条件は `OrderTableRow` 側で別途かかる） */
  visibleActions: readonly OrderRowAction[]
  /** 一括操作（シミュ・承認依頼）の対象にするか */
  selectable: boolean
  /** 操作カラムの先頭に出す、その区分の次の操作 */
  leadingActions?: (order: Order, actions: OrderActions) => ReactNode
}

const INTAKE_CATEGORY_CONFIG: Record<IntakeCategory, IntakeCategoryConfig> = {
  no_product: {
    visibleActions: ["convert_to_repair", "ship_without_routing", "delete"],
    selectable: false,
    leadingActions: (order, actions) => (
      <>
        <Button size="sm" variant="outline" onClick={() => actions.handleOpenEditDialog(order)}>
          製品を選ぶ
        </Button>
        <Button size="sm" variant="ghost" asChild>
          <Link href="/master/products">製品マスタに登録</Link>
        </Button>
      </>
    ),
  },
  no_routing: {
    visibleActions: ["edit", "convert_to_repair", "ship_without_routing", "delete"],
    selectable: false,
    leadingActions: (order) => (
      <Button size="sm" variant="outline" asChild>
        <Link href={`/master/products?highlight=${order.product_id}`}>工程を登録</Link>
      </Button>
    ),
  },
  incomplete: {
    visibleActions: ["convert_to_repair", "delete"],
    selectable: false,
    leadingActions: (order, actions) => (
      <Button size="sm" variant="outline" onClick={() => actions.handleOpenEditDialog(order)}>
        編集
      </Button>
    ),
  },
  unsimulated: {
    visibleActions: ["simulate", "edit", "convert_to_repair", "delete"],
    selectable: true,
  },
  simulated: {
    visibleActions: ["request_approval", "simulate", "edit", "convert_to_repair", "delete"],
    selectable: true,
  },
}

interface IntakeCategorySectionProps {
  category: IntakeCategory
  orders: Order[]
  products?: Product[]
  customers?: Customer[]
  currentUserRole: string | null
  actions: OrderActions
  bulk: OrderBulkActions
}

/** 「起票の確認」の区分ごとの表。列は共通で、操作を区分に合わせて絞る（Issue #555） */
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

  const selectAll = config.selectable ? (
    <Checkbox
      checked={bulk.getSelectAllState(orders)}
      onCheckedChange={() => bulk.handleToggleSelectAllOf(orders)}
      disabled={orders.length === 0 || bulk.isBulkOperationInProgress}
      aria-label={`${meta.label}をすべて選択`}
    />
  ) : undefined

  return (
    <section
      id={intakeSectionId(category)}
      aria-labelledby={`${intakeSectionId(category)}-heading`}
      className="mb-8 scroll-mt-4"
    >
      <div className="mb-2">
        <h2
          id={`${intakeSectionId(category)}-heading`}
          className="flex items-center gap-2 text-lg font-semibold"
        >
          {meta.label}
          <Badge variant="outline" className={cn(meta.cardClass, meta.countClass)}>
            {orders.length}件
          </Badge>
        </h2>
        <p className="text-sm text-muted-foreground">{meta.description}</p>
      </div>
      <OrdersTable
        isLoading={false}
        header={<OrderTableHeaderRow statusFilter="draft" selectAll={selectAll} />}
        rowCount={orders.length}
        emptyState={<p>該当する下書きはありません</p>}
      >
        {orders.map((order) => (
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
        ))}
      </OrdersTable>
    </section>
  )
}
