"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FilterCombobox } from "@/components/orders/filter-combobox"
import {
  ORDER_TYPE_FILTER_VALUES,
  ORDER_TYPE_LABELS,
  STATUS_TABS,
  SORT_OPTIONS,
  type OrderTypeFilter,
  type StatusFilter,
  type SortKey,
} from "@/lib/order-utils"
import type { Customer } from "@/types/customer"
import type { Product } from "@/types/product"

interface OrdersFilterBarProps {
  /** 生産／修理等の切り替え（`?type=`、Issue #494） */
  typeFilter: OrderTypeFilter
  statusFilter: StatusFilter
  sortKey: SortKey
  /** 顧客フィルタの ID（Issue #546）。null は未指定 */
  customerFilterId: number | null
  productFilterId: number | null
  customers?: Customer[]
  products?: Product[]
  onCustomerChange: (value: string) => void
  onProductChange: (value: string) => void
  onTypeChange: (value: string) => void
  onStatusChange: (value: string) => void
  onSortChange: (value: string) => void
}

export function OrdersFilterBar({
  typeFilter,
  statusFilter,
  sortKey,
  customerFilterId,
  productFilterId,
  customers,
  products,
  onCustomerChange,
  onProductChange,
  onTypeChange,
  onStatusChange,
  onSortChange,
}: OrdersFilterBarProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
      <Tabs value={typeFilter} onValueChange={onTypeChange}>
        <TabsList aria-label="注文の種別">
          {ORDER_TYPE_FILTER_VALUES.map((value) => (
            <TabsTrigger key={value} value={value}>
              {ORDER_TYPE_LABELS[value]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Tabs value={statusFilter} onValueChange={onStatusChange}>
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex items-center gap-2 flex-wrap">
        <FilterCombobox
          ariaLabel="顧客で絞り込み"
          value={customerFilterId === null ? "" : String(customerFilterId)}
          options={(customers ?? []).map((c) => ({
            value: String(c.id),
            label: c.name,
            keywords: [c.name, c.alias ?? ""],
          }))}
          onValueChange={onCustomerChange}
          placeholder="顧客: すべて"
          searchPlaceholder="顧客名または略称で検索..."
          emptyText="顧客が見つかりません"
        />
        {typeFilter === "production" && (
        <FilterCombobox
          ariaLabel="製品で絞り込み"
          value={productFilterId === null ? "" : String(productFilterId)}
          options={(products ?? []).map((p) => ({
            value: String(p.id),
            label: [p.code, p.name].filter(Boolean).join(" - "),
            keywords: [p.name, p.code ?? ""],
          }))}
          onValueChange={onProductChange}
          placeholder="製品: すべて"
          searchPlaceholder="製品名または製品コードで検索..."
          emptyText="製品が見つかりません"
        />
        )}
      <Select value={sortKey} onValueChange={onSortChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      </div>
    </div>
  )
}
