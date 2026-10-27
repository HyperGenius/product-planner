import type { ProcessDisplayState } from '@/lib/daily-report-progress-utils'

/** 工程の状態、または注文全体の「遅れあり」 */
export type StateBadgeState = ProcessDisplayState | 'delayed_some'

/** 状態バッジの色。色だけに頼らず文言（と ✓ / ！）も出す */
const STATE_BADGE_CLASS: Record<StateBadgeState, string> = {
  planned_only: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  not_started: 'border border-dashed border-blue-500 text-blue-700 dark:text-blue-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
  completed: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  delayed: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  delayed_some: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
}

/** ガントのラベル列・詳細シートの状態バッジ（Issue #580 / #581） */
export function StateBadge({
  state,
  text,
  size = 'sm',
}: {
  state: StateBadgeState
  text: string
  size?: 'sm' | 'md'
}) {
  const icon = state === 'completed' ? '✓ ' : state === 'delayed' || state === 'delayed_some' ? '！' : ''
  const sizeClass = size === 'md' ? 'px-1.5 text-xs leading-5' : 'px-1 text-[10px] leading-4'
  return (
    <span
      data-testid="row-state-badge"
      data-state={state}
      className={`shrink-0 whitespace-nowrap rounded font-semibold ${sizeClass} ${STATE_BADGE_CLASS[state]}`}
    >
      {icon}
      {text}
    </span>
  )
}
