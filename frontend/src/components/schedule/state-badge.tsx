import { CircleCheck, CircleDashed, CircleDot, ClockAlert, Flag, type LucideIcon } from 'lucide-react'
import type { ProcessDisplayState } from '@/lib/daily-report-progress-utils'

/** 工程の状態、または注文全体の「遅れあり」 */
export type StateBadgeState = ProcessDisplayState | 'delayed_some'

/** 状態バッジの色。色だけに頼らず文言とアイコンも出す */
const STATE_BADGE_CLASS: Record<StateBadgeState, string> = {
  planned_only: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  not_started: 'border border-dashed border-blue-500 text-blue-700 dark:text-blue-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
  completed: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  delayed: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  delayed_some: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
}

/**
 * 状態のアイコン（Issue #589）。ラベル列・凡例・詳細シートで共有し、見た目を食い違わせない。
 * 色だけで区別しないよう状態ごとに形を変える。計画のみはアイコンを出さない
 */
const STATE_ICONS: Record<StateBadgeState, { icon: LucideIcon; className: string } | null> = {
  planned_only: null,
  not_started: { icon: CircleDashed, className: 'text-blue-600 dark:text-blue-400' },
  in_progress: { icon: CircleDot, className: 'text-blue-600 dark:text-blue-400' },
  completed: { icon: CircleCheck, className: 'text-gray-500 dark:text-gray-400' },
  delayed: { icon: ClockAlert, className: 'text-red-600 dark:text-red-400' },
  delayed_some: { icon: ClockAlert, className: 'text-red-600 dark:text-red-400' },
}

/** 納期超過のアイコン。遅れ（計画終了を過ぎても未完了）とは意味が違うので形を変え、納期マーカー（⚑）と揃える */
const DEADLINE_EXCEEDED_ICON_CLASS = 'text-red-600 dark:text-red-400'

/**
 * ガントのラベル列の状態（アイコンのみ、Issue #589）。意味は凡例と詳細シートで示す。
 * `label` は読み上げ用（`進行中 60%` 等）
 */
export function StateIcon({ state, label }: { state: StateBadgeState; label: string }) {
  const def = STATE_ICONS[state]
  if (!def) return null
  const Icon = def.icon
  return (
    <Icon
      role="img"
      aria-label={label}
      data-testid="row-state-badge"
      data-state={state}
      className={`h-4 w-4 shrink-0 ${def.className}`}
    />
  )
}

/** 注文の最終工程の計画終了が希望納期を超えている印（ラベル列・凡例・詳細シート） */
export function DeadlineExceededIcon({ withText = false }: { withText?: boolean }) {
  if (withText) {
    return (
      <span
        data-testid="deadline-warning"
        className={`inline-flex items-center gap-0.5 whitespace-nowrap font-semibold ${DEADLINE_EXCEEDED_ICON_CLASS}`}
      >
        <Flag aria-hidden className="h-4 w-4 shrink-0" />
        納期超過
      </span>
    )
  }
  return (
    <Flag
      role="img"
      aria-label="納期超過"
      data-testid="deadline-warning"
      className={`h-4 w-4 shrink-0 ${DEADLINE_EXCEEDED_ICON_CLASS}`}
    />
  )
}

/** 凡例の見本に使う、状態のアイコン（装飾。文言は凡例側に並べる） */
export function StateIconSample({ state }: { state: StateBadgeState }) {
  const def = STATE_ICONS[state]
  if (!def) return null
  const Icon = def.icon
  return <Icon aria-hidden data-legend-icon={state} className={`h-4 w-4 shrink-0 ${def.className}`} />
}

/** 凡例の見本に使う、納期超過のアイコン（装飾） */
export function DeadlineExceededIconSample() {
  return <Flag aria-hidden data-legend-icon="deadline_exceeded" className={`h-4 w-4 shrink-0 ${DEADLINE_EXCEEDED_ICON_CLASS}`} />
}

/** 詳細シートの状態バッジ（Issue #580 / #581）。ラベル列と同じアイコンを文言の前に付ける */
export function StateBadge({ state, text }: { state: StateBadgeState; text: string }) {
  const Icon = STATE_ICONS[state]?.icon
  return (
    <span
      data-testid="state-badge"
      data-state={state}
      className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded px-1.5 text-xs font-semibold leading-5 ${STATE_BADGE_CLASS[state]}`}
    >
      {Icon && <Icon aria-hidden className="h-3.5 w-3.5" />}
      {text}
    </span>
  )
}
