'use client'

import { cn } from '@/lib/utils'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: string
}

/**
 * 選択肢が少ない切り替えのセグメントボタン（Issue #581）。`Select` と違って1タップで切り替えられ、
 * 選択中の値が常に見える。各ボタンの高さは 44px（タブレットのタップ目標）
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** グループの名前（読み上げ用） */
  label: string
  options: readonly SegmentedControlOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border bg-muted p-0.5">
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-11 min-w-14 rounded px-4 text-sm font-medium transition-colors',
              checked
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
