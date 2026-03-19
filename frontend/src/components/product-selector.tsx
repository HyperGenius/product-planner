"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useProducts } from "@/hooks/use-products"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface ProductSelectorProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

/**
 * 製品選択用コンボボックスコンポーネント
 * インクリメンタルサーチ（製品名・製品コード）とキーボード操作に対応
 */
export function ProductSelector({
  value,
  onValueChange,
  disabled = false,
}: ProductSelectorProps) {
  const { data: products, isLoading } = useProducts()
  const [open, setOpen] = React.useState(false)

  const selectedProduct = products?.find((p) => p.id.toString() === value)

  const handleSelect = (productId: string) => {
    onValueChange(productId)
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="product">製品 *</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id="product"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || isLoading}
            className="w-full justify-between font-normal"
          >
            <span className="truncate">
              {isLoading
                ? "読み込み中..."
                : selectedProduct
                  ? [selectedProduct.code, selectedProduct.name].filter(Boolean).join(" - ")
                  : "製品を選択"}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command
            filter={(itemValue, search) => {
              const product = products?.find((p) => p.id.toString() === itemValue)
              if (!product) return 0
              const searchLower = search.toLowerCase()
              const matchesName = product.name?.toLowerCase().includes(searchLower) ?? false
              const matchesCode = product.code?.toLowerCase().includes(searchLower) ?? false
              return matchesName || matchesCode ? 1 : 0
            }}
          >
            <CommandInput placeholder="製品名または製品コードで検索..." />
            <CommandList>
              <CommandEmpty>製品が見つかりません</CommandEmpty>
              <CommandGroup>
                {products?.map((product) => (
                  <CommandItem
                    key={product.id}
                    value={product.id.toString()}
                    onSelect={handleSelect}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === product.id.toString() ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {[product.code, product.name].filter(Boolean).join(" - ")}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
