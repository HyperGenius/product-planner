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

  return (
    <div
      ref={ref}
      style={{
        gridColumn: `${colStart} / ${colEnd}`,
        backgroundColor: task.color || '#3b82f6',
        ...style,
      }}
      className={`relative flex items-center px-2 h-7 rounded text-white text-xs overflow-visible mx-0.5 my-0.5 cursor-default z-[1] hover:z-[2]${className ? ` ${className}` : ''}`}
      {...props}
    >
      <span className="whitespace-nowrap [text-shadow:_0_1px_2px_rgba(0,0,0,0.8)]">
        {task.name}
      </span>
    </div>
  )
})
