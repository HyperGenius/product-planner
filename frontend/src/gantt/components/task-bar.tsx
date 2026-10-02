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
  if (task.isGroupHeader) {
    return (
      <div
        ref={ref}
        style={{
          gridColumn: `${colStart} / ${colEnd}`,
          backgroundColor: task.color ? `${task.color}22` : '#e5e7eb',
          borderLeft: `3px solid ${task.color || '#9ca3af'}`,
          ...style,
        }}
        className={`flex items-center px-2 h-8 rounded text-xs font-semibold text-gray-700 dark:text-gray-300 overflow-hidden mx-0.5${className ? ` ${className}` : ''}`}
        {...props}
      >
        <span className="truncate">{task.name}</span>
      </div>
    )
  }

  const delayed = task.isDelayed === true
  const labelClass = delayed
    ? 'text-red-600 dark:text-red-400 font-semibold'
    : 'text-gray-700 dark:text-gray-300'

  if (task.isMilestone) {
    const accent = delayed ? '#dc2626' : task.color || '#3b82f6'
    return (
      <div
        ref={ref}
        style={{ gridColumn: `${colStart} / ${colEnd}`, ...style }}
        className={`relative flex items-center h-7 text-xs overflow-visible mx-0.5 my-0.5 cursor-pointer z-[1] hover:z-[2]${className ? ` ${className}` : ''}`}
        data-delayed={delayed || undefined}
        {...props}
      >
        {/* ひし形マーカー（アウトラインのみ・開始時刻の列に配置）。
            bg-* はマーカー背後のグリッド線をマスクするために付けている */}
        <span
          aria-hidden
          style={{ borderColor: accent }}
          className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 rounded-[2px] border-2 bg-white dark:bg-gray-900"
        />
        <span className={`absolute left-4 whitespace-nowrap pointer-events-none ${labelClass}`}>
          {task.name}
        </span>
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
      <span className={`absolute left-full ml-1 whitespace-nowrap pointer-events-none ${labelClass}`}>
        {task.name}
      </span>
    </div>
  )
})
