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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface FilterComboboxOption {
  /** ID の文字列 */
  value: string
  label: string
  /** 検索対象（名前・略称・コード等） */
  keywords: string[]
}

interface FilterComboboxProps {
  /** 選択中の ID。空文字は未指定（すべて） */
  value: string
  options: FilterComboboxOption[]
  onValueChange: (value: string) => void
  /** 未指定のときのトリガー表示（例: 「顧客: すべて」） */
  placeholder: string
  searchPlaceholder: string
  emptyText: string
  ariaLabel: string
  disabled?: boolean
}

const CLEAR_SELECTION_VALUE = "__clear__"

/**
 * 一覧の絞り込み用コンボボックス（Issue #546）。件数が増えうるマスタなので Select ではなく
 * Popover + Command。CommandItem の value は ID なので、名前等（keywords）で照合する。
 */
export function FilterCombobox({
  value,
  options,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  ariaLabel,
  disabled = false,
}: FilterComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const selected = options.find((o) => o.value === value)

  const handleSelect = (next: string) => {
    onValueChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-[220px] justify-between font-normal",
            !selected && "text-muted-foreground"
          )}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command
          filter={(_itemValue, search, keywords) => {
            const searchLower = search.toLowerCase()
            return (keywords ?? []).some((k) => k.toLowerCase().includes(searchLower)) ? 1 : 0
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {selected && (
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
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={option.keywords}
                  onSelect={() => handleSelect(option.value)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
