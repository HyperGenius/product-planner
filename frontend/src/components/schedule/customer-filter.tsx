'use client'

import { useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { ScheduleCustomerFilter, ScheduleCustomerOption } from '@/lib/schedule-customer-filter'

const ALL_VALUE = 'all'
const optionValue = (customerId: number | null) => `customer-${customerId ?? 'unknown'}`

/**
 * 生産スケジュールの顧客の絞り込み（Issue #597）。1社（または「すべて」）を選ぶ検索付きコンボボックス。
 * 選択肢は表示中の期間に予定がある顧客（`listScheduleCustomers()`）
 */
export function CustomerFilter({
  options,
  value,
  onChange,
  disabled,
}: {
  options: ScheduleCustomerOption[]
  value: ScheduleCustomerFilter | null
  onChange: (value: ScheduleCustomerFilter | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const select = (next: ScheduleCustomerFilter | null) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="顧客選択"
          disabled={disabled}
          className="h-11 w-[220px] justify-between"
        >
          <span className="truncate">{value?.label ?? 'すべて'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0">
        <Command
          // CommandItem の value は顧客 ID なので、通称・正式名称（keywords）で絞り込む。「すべて」は検索中は出さない
          filter={(_itemValue, search, keywords) => {
            const searchLower = search.toLowerCase()
            return (keywords ?? []).some((k) => k.toLowerCase().includes(searchLower)) ? 1 : 0
          }}
        >
          <CommandInput placeholder="顧客を検索..." className="h-11" />
          <CommandList>
            <CommandEmpty>見つかりません</CommandEmpty>
            <CommandGroup>
              <CommandItem value={ALL_VALUE} className="min-h-11" onSelect={() => select(null)}>
                <Check className={cn('mr-2 h-4 w-4', value === null ? 'opacity-100' : 'opacity-0')} />
                すべて
              </CommandItem>
              {options.map((option) => (
                <CommandItem
                  key={optionValue(option.customerId)}
                  value={optionValue(option.customerId)}
                  keywords={option.keywords}
                  className="min-h-11"
                  onSelect={() => select({ customerId: option.customerId, label: option.label })}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value !== null && value.customerId === option.customerId ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
