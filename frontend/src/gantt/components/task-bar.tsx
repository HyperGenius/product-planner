import { forwardRef } from 'react'
import type { GanttTask } from '../types'

type TaskBarProps = {
  task: GanttTask
  colStart: number
  colEnd: number
} & React.HTMLAttributes<HTMLDivElement>

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
        className={`relative h-3 mx-0.5${className ? ` ${className}` : ''}`}
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

  const delayed = task.isDelayed === true

  if (task.isMilestone) {
    const accent = delayed ? '#dc2626' : task.color || '#3b82f6'
    return (
      <div
        ref={ref}
        style={{ gridColumn: `${colStart} / ${colEnd}`, ...style }}
        className={`relative flex items-center h-7 text-xs overflow-visible mx-0.5 my-0.5 cursor-pointer z-[1] hover:z-[2]${className ? ` ${className}` : ''}`}
        data-delayed={delayed || undefined}
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

  return (
    <div
      ref={ref}
      style={{
        gridColumn: `${colStart} / ${colEnd}`,
        backgroundColor: task.color || '#3b82f6',
        ...style,
      }}
      className={`relative flex items-center h-7 rounded text-xs overflow-visible mx-0.5 my-0.5 cursor-pointer z-[1] hover:z-[2]${delayed ? ' ring-2 ring-red-600 ring-offset-1 ring-offset-white dark:ring-offset-gray-900' : ''}${className ? ` ${className}` : ''}`}
      data-progress={progressPct !== null ? Math.round(progressPct) : undefined}
      data-delayed={delayed || undefined}
      data-task-id={task.id}
      {...continuationAttrs}
      {...props}
    >
      {/* 進捗の塗り: バーの色の上に暗いレイヤーを重ねて、済んだ割合を示す */}
      {progressPct !== null && progressPct > 0 && (
        <span
          aria-hidden
          data-testid="task-bar-progress"
          style={{ width: `${progressPct}%` }}
          className={`absolute inset-y-0 left-0 bg-black/35 pointer-events-none ${progressPct >= 100 ? 'rounded' : 'rounded-l'}`}
        />
      )}
      {continuesBefore && (
        <ContinuationArrow side="start" color="rgba(255,255,255,0.9)" className="top-1/2 -translate-y-1/2 ml-0.5" />
      )}
      {continuesAfter && (
        <ContinuationArrow side="end" color="rgba(255,255,255,0.9)" className="top-1/2 -translate-y-1/2 mr-0.5" />
      )}
    </div>
  )
})

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
