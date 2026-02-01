"use client"

import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCustomers } from "@/hooks/use-customers"
import { Label } from "@/components/ui/label"

interface CustomerSelectorProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

/**
 * 顧客選択用コンボボックスコンポーネント
 */
export function CustomerSelector({
  value,
  onValueChange,
  disabled = false,
}: CustomerSelectorProps) {
  const { data: customers, isLoading } = useCustomers()

  return (
    <div className="space-y-2">
      <Label htmlFor="customer">顧客</Label>
      <Select 
        value={value} 
        onValueChange={onValueChange} 
        disabled={disabled || isLoading}
      >
        <SelectTrigger id="customer" aria-busy={isLoading}>
          <SelectValue placeholder={isLoading ? "読み込み中..." : "顧客を選択（任意）"} />
        </SelectTrigger>
        <SelectContent>
          {customers && customers.length > 0 ? (
            customers.map((customer) => (
              <SelectItem key={customer.id} value={customer.id.toString()}>
                {customer.name}
              </SelectItem>
            ))
          ) : (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              顧客が登録されていません
            </div>
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
