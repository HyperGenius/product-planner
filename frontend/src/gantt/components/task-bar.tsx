import { forwardRef } from 'react'
import type { GanttBarAppearance, GanttTask } from '../types'

type TaskBarProps = {
  task: GanttTask
  colStart: number
  colEnd: number
} & React.HTMLAttributes<HTMLDivElement>

/**
 * タップできるバーのタップ範囲（44px 四方以上。Issue #581）。見た目の大きさは変えず、透明な ::before を
 * バーの中心に重ねて広げる。同じ行のバーは同じ作業（rowId）なので、隣のバーと重なっても困らない
 */
const HIT_AREA =
  'before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-full before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2'

/**
 * ガントチャートの1タスク分のバーコンポーネント
 * forwardRef で ref と HTML イベントハンドラーを DOM に転送することで
 * Radix UI の Tooltip（asChild）などが正常に動作する
 */
export const TaskBar = forwardRef<HTMLDivElement, TaskBarProps>(function TaskBar(
  { task, colStart, colEnd, className, style, ...props },
  ref,
) {
  const continuesBefore = task.continuesBefore === true
  const continuesAfter = task.continuesAfter === true
  const continuationAttrs = {
    'data-continues-before': continuesBefore || undefined,
    'data-continues-after': continuesAfter || undefined,
  }
  const hitArea = props.onClick ? ` cursor-pointer ${HIT_AREA}` : ''

  if (task.isGroupHeader) {
    // 細いサマリーバー（ブラケット形）: 上辺の梁＋両端の短い脚。工程のバー（h-7）と太さで区別する。
    // 範囲外へ続く側は脚の代わりに外向きの矢印を出す
    const color = task.color || '#4b5563'
    return (
      <div
        ref={ref}
        style={{ gridColumn: `${colStart} / ${colEnd}`, ...style }}
        data-task-id={task.id}
        data-summary-bar
        {...continuationAttrs}
        className={`relative h-3 mx-0.5${hitArea}${className ? ` ${className}` : ''}`}
        {...props}
      >
        <span
          aria-hidden
          className="absolute top-0 h-2"
          style={{
            backgroundColor: color,
            left: continuesBefore ? '6px' : 0,
            right: continuesAfter ? '6px' : 0,
          }}
        />
        {continuesBefore ? (
          <ContinuationArrow side="start" color={color} className="-top-px" />
        ) : (
          <span aria-hidden className="absolute left-0 top-0 h-3 w-[3px]" style={{ backgroundColor: color }} />
        )}
        {continuesAfter ? (
          <ContinuationArrow side="end" color={color} className="-top-px" />
        ) : (
          <span aria-hidden className="absolute right-0 top-0 h-3 w-[3px]" style={{ backgroundColor: color }} />
        )}
        <span className="sr-only">{task.name}</span>
      </div>
    )
  }

  const appearance = task.appearance ?? 'default'
  const dimmed = task.dimmed === true ? ' opacity-40' : ''

  if (task.isGhost) {
    const color = task.color || '#3b82f6'
    return (
      <div
        ref={ref}
        style={{ gridColumn: `${colStart} / ${colEnd}`, ...style }}
        data-task-id={task.id}
        data-ghost
        className={`pointer-events-none relative z-[3] mx-0.5 my-0.5 h-7 overflow-visible${className ? ` ${className}` : ''}`}
        {...props}
      >
        {task.isMilestone ? (
          <span
            aria-hidden
            style={{ borderColor: color }}
            className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 rounded-[2px] border-2 border-dashed bg-white/70 dark:bg-gray-900/70"
          />
        ) : (
          <span
            aria-hidden
            style={{ borderColor: color, backgroundColor: `color-mix(in srgb, ${color} 25%, transparent)` }}
            className="absolute inset-0 rounded border-2 border-dashed"
          />
        )}
        <span className="sr-only">{task.name}</span>
      </div>
    )
  }

  if (task.isMilestone) {
    const accent = MILESTONE_ACCENT[appearance] ?? task.color ?? '#3b82f6'
    return (
      <div
        ref={ref}
        style={{ gridColumn: `${colStart} / ${colEnd}`, ...style }}
        className={`relative flex items-center h-7 text-xs overflow-visible mx-0.5 my-0.5 cursor-pointer z-[1] hover:z-[2]${dimmed}${hitArea}${className ? ` ${className}` : ''}`}
        data-appearance={appearance}
        data-dimmed={task.dimmed || undefined}
        data-task-id={task.id}
        {...props}
      >
        {/* ひし形マーカー（アウトラインのみ・開始時刻の列に配置）。
            bg-* はマーカー背後のグリッド線をマスクするために付けている */}
        <span
          aria-hidden
          style={{ borderColor: accent }}
          className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 rounded-[2px] border-2 bg-white dark:bg-gray-900"
        />
      </div>
    )
  }

  // 0〜100 に丸める（範囲外・NaN は塗らない側へ寄せる）
  const progressPct =
    task.progress !== undefined && Number.isFinite(task.progress)
      ? Math.min(Math.max(task.progress, 0), 1) * 100
      : null
  const showProgress = progressPct !== null && progressPct > 0 && PROGRESS_APPEARANCES.has(appearance)
  const look = BAR_LOOK[appearance]
  const baseColor = task.color || '#3b82f6'
  const arrowColor = appearance === 'subtle' || appearance === 'muted' ? '#6b7280' : 'rgba(255,255,255,0.9)'

  return (
    <div
      ref={ref}
      style={{
        gridColumn: `${colStart} / ${colEnd}`,
        ...(appearance === 'default' ? { backgroundColor: baseColor } : {}),
        ...(appearance === 'subtle' ? { borderColor: baseColor } : {}),
        ...style,
      }}
      className={`relative flex items-center h-7 rounded text-xs overflow-visible mx-0.5 my-0.5 cursor-pointer z-[1] hover:z-[2] ${look}${dimmed}${hitArea}${className ? ` ${className}` : ''}`}
      data-dimmed={task.dimmed || undefined}
      data-progress={progressPct !== null ? Math.round(progressPct) : undefined}
      data-appearance={appearance}
      data-task-id={task.id}
      {...continuationAttrs}
      {...props}
    >
      {/* 進捗の塗り: バーの色の上に暗いレイヤーを重ねて、済んだ割合を示す */}
      {showProgress && (
        <span
          aria-hidden
          data-testid="task-bar-progress"
          style={{ width: `${progressPct}%` }}
          className={`absolute inset-y-0 left-0 bg-black/35 pointer-events-none ${progressPct >= 100 ? 'rounded' : 'rounded-l'}`}
        />
      )}
      {continuesBefore && (
        <ContinuationArrow side="start" color={arrowColor} className="top-1/2 -translate-y-1/2 ml-0.5" />
      )}
      {task.badge && (
        <span
          data-testid="task-bar-badge"
          className="relative ml-auto truncate px-1.5 font-semibold leading-none pointer-events-none"
        >
          {task.badge}
        </span>
      )}
      {continuesAfter && (
        <ContinuationArrow side="end" color={arrowColor} className="top-1/2 -translate-y-1/2 mr-0.5" />
      )}
    </div>
  )
})

/** 外観ごとのクラス（背景・枠・文字色）。default の背景色と subtle の枠色は task.color をインラインで当てる */
const BAR_LOOK: Record<GanttBarAppearance, string> = {
  default: 'text-white',
  neutral: 'bg-gray-300 text-gray-700 dark:bg-gray-600 dark:text-gray-100',
  subtle: 'border-2 border-dashed bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-200',
  muted: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-300',
  danger:
    'bg-red-600 text-white ring-1 ring-red-800 dark:bg-red-500 dark:ring-red-300 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.28)_0,rgba(255,255,255,0.28)_4px,transparent_4px,transparent_9px)]',
}

/** 進捗の塗りを重ねる外観（淡い・くすんだ・無彩色のバーは塗らない） */
const PROGRESS_APPEARANCES: ReadonlySet<GanttBarAppearance> = new Set(['default', 'danger'])

/** マイルストーンのひし形の色（default は task.color） */
const MILESTONE_ACCENT: Partial<Record<GanttBarAppearance, string>> = {
  danger: '#dc2626',
  muted: '#9ca3af',
  neutral: '#6b7280',
}

/**
 * 表示範囲の外へ続くことを示す外向きの三角。サマリーバーはバーの色で端に、
 * 通常のバーはバーの内側に白で描く
 */
function ContinuationArrow({
  side,
  color,
  className,
}: {
  side: 'start' | 'end'
  color: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-testid={`task-bar-continues-${side}`}
      className={`absolute h-0 w-0 border-y-[5px] border-y-transparent ${
        side === 'start' ? 'left-0 border-r-[6px]' : 'right-0 border-l-[6px]'
      }${className ? ` ${className}` : ''}`}
      style={side === 'start' ? { borderRightColor: color } : { borderLeftColor: color }}
    />
  )
}
