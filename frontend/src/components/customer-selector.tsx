"use client"

import * as React from "react"
import { Check, ChevronsUpDown, X } from "lucide-react"
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
import { useCustomers } from "@/hooks/use-customers"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface CustomerSelectorProps {
  /** 選択中の顧客 ID。空文字は未選択 */
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
}

const CLEAR_SELECTION_VALUE = "__clear__"

/**
 * 顧客選択用コンボボックスコンポーネント
 * インクリメンタルサーチ（顧客名・略称）とキーボード操作に対応 (Issue #509)
 */
export function CustomerSelector({
  value,
  onValueChange,
  disabled = false,
}: CustomerSelectorProps) {
  const { data: customers, isLoading } = useCustomers()
  const [open, setOpen] = React.useState(false)
  // 分割ダイアログのように1画面に複数並ぶので、ラベルとトリガーの id は固定にしない
  const triggerId = React.useId()

  const selectedCustomer = customers?.find((c) => c.id.toString() === value)
  const hasCustomers = (customers?.length ?? 0) > 0

  const handleSelect = (customerId: string) => {
    onValueChange(customerId)
    setOpen(false)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={triggerId}>顧客</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={triggerId}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-busy={isLoading}
            disabled={disabled || isLoading}
            className="w-full justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">
                {isLoading
                  ? "読み込み中..."
                  : selectedCustomer
                    ? selectedCustomer.name
                    : "顧客を選択（任意）"}
              </span>
              {selectedCustomer?.status === "draft" && (
                <Badge variant="secondary">下書き</Badge>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command
            // CommandItem の value は顧客 ID なので、cmdk 既定の value 照合ではなく名前・略称（keywords）で絞り込む。
            // 「選択を解除」は keywords を持たないので、検索中は出さない
            filter={(_itemValue, search, keywords) => {
              const searchLower = search.toLowerCase()
              return (keywords ?? []).some((k) => k.toLowerCase().includes(searchLower)) ? 1 : 0
            }}
          >
            <CommandInput placeholder="顧客名または略称で検索..." />
            <CommandList>
              <CommandEmpty>
                {hasCustomers ? "顧客が見つかりません" : "顧客が登録されていません"}
              </CommandEmpty>
              {value && (
                <CommandGroup>
                  <CommandItem
                    value={CLEAR_SELECTION_VALUE}
                    onSelect={() => handleSelect("")}
                    className="text-muted-foreground"
                  >
                    <X className="mr-2 h-4 w-4" />
                    選択を解除
                  </CommandItem>
                </CommandGroup>
              )}
              <CommandGroup>
                {customers?.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={customer.id.toString()}
                    keywords={[customer.name, customer.alias ?? ""]}
                    onSelect={() => handleSelect(customer.id.toString())}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        value === customer.id.toString() ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{customer.name}</span>
                    {customer.alias && (
                      <span className="ml-2 shrink-0 truncate text-xs text-muted-foreground">
                        {customer.alias}
                      </span>
                    )}
                    {customer.status === "draft" && (
                      <Badge variant="secondary" className="ml-auto shrink-0">
                        下書き
                      </Badge>
                    )}
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
