import type { GanttTask } from '../types'

interface TaskBarProps {
  task: GanttTask
  colStart: number
  colEnd: number
}

/**
 * ガントチャートの1タスク分のバーコンポーネント
 */
export function TaskBar({ task, colStart, colEnd }: TaskBarProps) {
  if (task.isGroupHeader) {
    return (
      <div
        style={{
          gridColumn: `${colStart} / ${colEnd}`,
          backgroundColor: task.color ? `${task.color}22` : '#e5e7eb',
          borderLeft: `3px solid ${task.color || '#9ca3af'}`,
        }}
        className="flex items-center px-2 h-8 rounded text-xs font-semibold text-gray-700 dark:text-gray-300 overflow-hidden mx-0.5"
      >
        <span className="truncate">{task.name}</span>
      </div>
    )
  }

  return (
    <div
      style={{
        gridColumn: `${colStart} / ${colEnd}`,
        backgroundColor: task.color || '#3b82f6',
      }}
      className="relative flex items-center px-2 h-7 rounded text-white text-xs overflow-visible mx-0.5 my-0.5 cursor-default z-[1] hover:z-[2]"
    >
      <span className="whitespace-nowrap [text-shadow:_0_1px_2px_rgba(0,0,0,0.8)]">
        {task.name}
      </span>
    </div>
  )
}
