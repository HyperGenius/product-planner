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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useCustomers } from "@/hooks/use-customers"
import { useEquipments } from "@/hooks/use-equipments"
import { useProducts } from "@/hooks/use-products"
import { useMasterProcessNames } from "@/hooks/use-daily-report-names"
import { equipmentDisplayName, sortEquipments } from "@/lib/equipment-utils"
import { cn } from "@/lib/utils"
import type { ProductCandidate } from "@/types/daily-report-names"

/**
 * 日報の表記の対応付け先（設備・顧客・製品・工程）を選ぶコンボボックス (Issue #489)。
 * 未照合キューの「対応付け」と、登録済みの対応付けの「変更」で共用する。
 */

interface TargetOption {
  id: number
  label: string
  hint?: string
  /** 検索対象の文字列（label・hint 以外。品番・正式名称等） */
  keywords?: string[]
}

interface TargetGroup {
  heading?: string
  options: TargetOption[]
}

interface TargetComboboxProps {
  groups: TargetGroup[]
  triggerLabel: string
  searchPlaceholder: string
  emptyText: string
  onSelect: (id: number) => void
  selectedId?: number | null
  disabled?: boolean
  loading?: boolean
  /** 一覧の行ごとに置くので、どの表記の操作かを読み上げで分かるようにする */
  ariaLabel: string
}

function TargetCombobox({
  groups,
  triggerLabel,
  searchPlaceholder,
  emptyText,
  onSelect,
  selectedId = null,
  disabled = false,
  loading = false,
  ariaLabel,
}: TargetComboboxProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled || loading}
          className="max-w-[16rem] justify-between font-normal"
        >
          <span className="truncate">{loading ? "読み込み中..." : triggerLabel}</span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command
          filter={(_value, search, keywords) => {
            const needle = search.toLowerCase()
            return (keywords ?? []).some((k) => k.toLowerCase().includes(needle)) ? 1 : 0
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groups.map((group, groupIndex) =>
              group.options.length === 0 ? null : (
                <CommandGroup key={group.heading ?? groupIndex} heading={group.heading}>
                  {group.options.map((option) => (
                    <CommandItem
                      // 候補と全件で同じ製品が2回出るので、cmdk の value はグループで一意にする
                      key={`${groupIndex}-${option.id}`}
                      value={`${groupIndex}-${option.id}`}
                      keywords={[option.label, option.hint ?? "", ...(option.keywords ?? [])]}
                      onSelect={() => {
                        setOpen(false)
                        onSelect(option.id)
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          selectedId === option.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{option.label}</span>
                      {option.hint && (
                        <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface SinglePickerProps {
  onSelect: (id: number) => void
  selectedId?: number | null
  disabled?: boolean
  triggerLabel?: string
  ariaLabel: string
}

export function EquipmentPicker({
  triggerLabel = "設備を選択",
  ...props
}: SinglePickerProps) {
  const { data: equipments, isLoading } = useEquipments()
  const options = sortEquipments(equipments ?? [], "ledger_no").map((e) => ({
    id: e.id,
    label: equipmentDisplayName(e),
    hint: e.ledger_no != null ? `台帳No.${e.ledger_no}` : undefined,
    keywords: [e.name, e.short_name ?? ""],
  }))
  return (
    <TargetCombobox
      {...props}
      groups={[{ options }]}
      triggerLabel={triggerLabel}
      loading={isLoading}
      searchPlaceholder="設備名・呼称・台帳番号で検索..."
      emptyText="設備が見つかりません"
    />
  )
}

export function CustomerPicker({
  triggerLabel = "顧客を選択",
  ...props
}: SinglePickerProps) {
  const { data: customers, isLoading } = useCustomers()
  const options = (customers ?? []).map((c) => ({
    id: c.id,
    label: c.name,
    hint: c.alias || undefined,
  }))
  return (
    <TargetCombobox
      {...props}
      groups={[{ options }]}
      triggerLabel={triggerLabel}
      loading={isLoading}
      searchPlaceholder="顧客名・略称で検索..."
      emptyText="顧客が見つかりません"
    />
  )
}

export function ProductPicker({
  triggerLabel = "他の製品から選択",
  candidates = [],
  ...props
}: SinglePickerProps & { candidates?: ProductCandidate[] }) {
  const { data: products, isLoading } = useProducts()
  const options = (products ?? [])
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, label: p.name, hint: p.code ?? undefined }))
  const candidateOptions = candidates.map((c) => ({
    id: c.product_id,
    label: c.name,
    hint: `類似度 ${Math.round(c.score * 100)}%`,
  }))
  return (
    <TargetCombobox
      {...props}
      groups={[
        { heading: "似ている製品", options: candidateOptions },
        { heading: "すべての製品", options },
      ]}
      triggerLabel={triggerLabel}
      loading={isLoading}
      searchPlaceholder="製品名・品番で検索..."
      emptyText="製品が見つかりません"
    />
  )
}

interface ProcessPickerProps {
  /** 現在の対応先（変更時）。未照合キューでは空 */
  initialNames?: string[]
  onSubmit: (names: string[]) => void
  disabled?: boolean
  triggerLabel?: string
  ariaLabel: string
}

/** 工程は1つの表記が複数の工程を指しうる（1:N）ので、複数選択してから登録する */
export function ProcessPicker({
  initialNames = [],
  onSubmit,
  disabled = false,
  triggerLabel = "工程を選択",
  ariaLabel,
}: ProcessPickerProps) {
  const { data: processNames, isLoading } = useMasterProcessNames()
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>(initialNames)

  const toggle = (name: string) =>
    setSelected((current) =>
      current.includes(name) ? current.filter((n) => n !== name) : [...current, name],
    )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // 開き直したら現在の対応先から選び直す（前回の選びかけを持ち越さない）
        if (next) setSelected(initialNames)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled || isLoading}
          className="max-w-[16rem] justify-between font-normal"
        >
          <span className="truncate">{isLoading ? "読み込み中..." : triggerLabel}</span>
          <ChevronsUpDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="工程名で検索..." />
          <CommandList>
            <CommandEmpty>工程が見つかりません</CommandEmpty>
            <CommandGroup heading="複数選択できます">
              {(processNames ?? []).map((name) => (
                <CommandItem key={name} value={name} onSelect={() => toggle(name)}>
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      selected.includes(name) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between gap-2 border-t p-2">
          <span className="truncate text-xs text-muted-foreground">
            {selected.length > 0 ? selected.join("・") : "未選択"}
          </span>
          <Button
            size="sm"
            disabled={selected.length === 0}
            onClick={() => {
              setOpen(false)
              onSubmit(selected)
            }}
          >
            決定
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
