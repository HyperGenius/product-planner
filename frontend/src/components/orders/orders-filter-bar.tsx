"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { STATUS_TABS, SORT_OPTIONS, type StatusFilter, type SortKey } from "@/lib/order-utils"

interface OrdersFilterBarProps {
  statusFilter: StatusFilter
  sortKey: SortKey
  onStatusChange: (value: string) => void
  onSortChange: (value: string) => void
}

export function OrdersFilterBar({
  statusFilter,
  sortKey,
  onStatusChange,
  onSortChange,
}: OrdersFilterBarProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
      <Tabs value={statusFilter} onValueChange={onStatusChange}>
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

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
  )
}
