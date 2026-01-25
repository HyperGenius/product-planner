"use client"

import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProducts } from "@/hooks/use-products"
import { Label } from "@/components/ui/label"

interface ProductSelectorProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

/**
 * 製品選択用コンボボックスコンポーネント
 */
export function ProductSelector({
  value,
  onValueChange,
  disabled = false,
}: ProductSelectorProps) {
  const { data: products, isLoading } = useProducts()

  return (
    <div className="space-y-2">
      <Label htmlFor="product">製品 *</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled || isLoading}>
        <SelectTrigger id="product">
          <SelectValue placeholder={isLoading ? "読み込み中..." : "製品を選択"} />
        </SelectTrigger>
        <SelectContent>
          {products?.map((product) => (
            <SelectItem key={product.id} value={product.id.toString()}>
              {product.code} - {product.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
