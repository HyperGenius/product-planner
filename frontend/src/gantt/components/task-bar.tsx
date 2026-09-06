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

  if (task.isMilestone) {
    const accent = task.color || '#3b82f6'
    return (
      <div
        ref={ref}
        style={{ gridColumn: `${colStart} / ${colEnd}`, ...style }}
        className={`relative flex items-center h-7 text-xs overflow-visible mx-0.5 my-0.5 cursor-pointer z-[1] hover:z-[2]${className ? ` ${className}` : ''}`}
        {...props}
      >
        {/* ひし形マーカー（アウトラインのみ・開始時刻の列に配置）。
            bg-* はマーカー背後のグリッド線をマスクするために付けている */}
        <span
          aria-hidden
          style={{ borderColor: accent }}
          className="absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 rounded-[2px] border-2 bg-white dark:bg-gray-900"
        />
        <span className="absolute left-4 whitespace-nowrap text-gray-700 dark:text-gray-300 pointer-events-none">
          {task.name}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      style={{
        gridColumn: `${colStart} / ${colEnd}`,
        backgroundColor: task.color || '#3b82f6',
        ...style,
      }}
      className={`relative flex items-center h-7 rounded text-xs overflow-visible mx-0.5 my-0.5 cursor-pointer z-[1] hover:z-[2]${className ? ` ${className}` : ''}`}
      {...props}
    >
      <span className="absolute left-full ml-1 whitespace-nowrap text-gray-700 dark:text-gray-300 pointer-events-none">
        {task.name}
      </span>
    </div>
  )
})
