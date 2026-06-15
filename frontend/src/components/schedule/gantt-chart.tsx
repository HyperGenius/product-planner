/* frontend/src/components/schedule/gantt-chart.tsx */
'use client'

import { useMemo } from 'react'
import {
  addDays,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  format,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import { GanttChart as GanttChartLib } from '@/gantt'
import type { GanttTask } from '@/gantt'
import type { Schedule, GanttViewMode, GroupByMode } from '@/types/schedule'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** 稼働時間定数（backend/app/utils/calendar.py と同値） */
const WORK_HOURS = { start: 9, end: 17, breakStart: 12, breakEnd: 13 } as const

/**
 * ガントチャートコンポーネントのProps
 */
export interface GanttChartProps {
  /**
   * スケジュールデータの配列
   */
  tasks: Schedule[]
  /**
   * 表示モード (Day/Week/Month)
   */
  viewMode?: GanttViewMode
  /**
   * カラーモード: 'product' (製品ごとに色分け) または 'process' (工程ごとに色分け)
   */
  colorMode?: 'product' | 'process'
  /**
   * 編集可能かどうか（Phase 1: Read-Only のため現在は未使用）
   */
  isEditable?: boolean
  /**
   * グルーピングモード: 'none' (フラット表示) | 'order' (オーダー別) | 'equipment_group' (設備グループ別)
   */
  groupBy?: GroupByMode
  /**
   * 表示の基準日（タイムライン範囲の計算に使用）
   */
  currentDate?: Date
  /**
   * 非稼働日の Date 配列（祝日・土日）。週次モード時にグリッドから除外する。
   */
  nonWorkingDays?: Date[]
  /**
   * タスクバーがクリックされた際に発火するコールバック
   */
  onTaskClick?: (schedule: Schedule) => void
}

/**
 * スケジュールに基づいてバーの色を決定する
 */
function getBarColor(schedule: Schedule, colorMode: 'product' | 'process'): string {
  if (colorMode === 'product') {
    const productName = schedule.product_name || 'default'
    const hash = productName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const hue = hash % 360
    return `hsl(${hue}, 70%, 50%)`
  }

  const processColors: Record<string, string> = {
    '切削': '#ef4444',
    '組立': '#3b82f6',
    '検査': '#10b981',
    '塗装': '#f59e0b',
    '梱包': '#8b5cf6',
    default: '#6b7280',
  }
  return processColors[schedule.process_name || 'default'] ?? processColors['default']
}

/**
 * 注文の表示キーを返す（ユーザー定義注文番号 or 内部ID）
 */
function orderKey(schedule: Schedule): string {
  return schedule.order_number || `#${schedule.order_id}`
}

/**
 * Schedule型からGanttTask型に変換するユーティリティ関数
 */
export function convertScheduleToTask(
  schedule: Schedule,
  colorMode: 'product' | 'process' = 'product',
  groupBy: GroupByMode = 'none',
): GanttTask {
  const processName = schedule.process_name || '工程'

  let suffix: string
  if (groupBy === 'equipment_group') {
    suffix = orderKey(schedule)
  } else {
    suffix = schedule.equipment_group_name ?? ''
  }

  const name = suffix ? `${processName} - ${suffix}` : processName

  return {
    id: `schedule-${schedule.id}`,
    name,
    start: new Date(schedule.start_datetime),
    end: new Date(schedule.end_datetime),
    color: getBarColor(schedule, colorMode),
  }
}

/**
 * 週次モード用: 同一 order_id + process_name のセグメントを1行に集約する
 */
function aggregateSegments(
  schedules: Schedule[],
  colorMode: 'product' | 'process',
  groupBy: GroupByMode,
): GanttTask[] {
  const groups = new Map<string, Schedule[]>()
  schedules.forEach((s) => {
    const key = `${s.order_id}__${s.process_name ?? ''}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  })

  const result: GanttTask[] = []
  groups.forEach((items) => {
    const sorted = [...items].sort(
      (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime(),
    )
    const first = sorted[0]
    const last = sorted[sorted.length - 1]

    const processName = first.process_name || '工程'
    let suffix: string
    if (groupBy === 'equipment_group') {
      suffix = orderKey(first)
    } else {
      suffix = first.equipment_group_name ?? ''
    }
    const name = suffix ? `${processName} - ${suffix}` : processName

    result.push({
      id: `schedule-${first.id}`,
      name,
      start: new Date(first.start_datetime),
      end: new Date(last.end_datetime),
      color: getBarColor(first, colorMode),
    })
  })

  return result.sort((a, b) => a.start.getTime() - b.start.getTime())
}

/**
 * スケジュールをグルーピングモードに応じてGanttTask配列に変換する
 */
function transformSchedulesToGroupedTasks(
  schedules: Schedule[],
  groupBy: GroupByMode,
  colorMode: 'product' | 'process',
  viewMode: GanttViewMode,
): GanttTask[] {
  const sortByStartDate = (items: Schedule[]) =>
    [...items].sort(
      (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime(),
    )

  const shouldAggregate = viewMode === 'Week'

  if (groupBy === 'none') {
    const sorted = sortByStartDate(schedules)
    if (shouldAggregate) {
      return aggregateSegments(sorted, colorMode, 'none')
    }
    return sorted.map((s) => convertScheduleToTask(s, colorMode, 'none'))
  }

  const tasks: GanttTask[] = []

  if (groupBy === 'order') {
    const groups = new Map<string, Schedule[]>()
    schedules.forEach((s) => {
      const key = s.order_number || String(s.order_id)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(s)
    })

    Array.from(groups.entries())
      .map(([key, items]) => {
        const sorted = sortByStartDate(items)
        const minStart = new Date(
          Math.min(...sorted.map((s) => new Date(s.start_datetime).getTime())),
        )
        return { key, items: sorted, minStart }
      })
      .sort((a, b) => a.minStart.getTime() - b.minStart.getTime())
      .forEach(({ key, items }) => {
        const starts = items.map((s) => new Date(s.start_datetime).getTime())
        const ends = items.map((s) => new Date(s.end_datetime).getTime())
        const displayKey = items[0]?.order_number || `#${items[0]?.order_id}`
        const productName = items[0]?.product_name || ''
        const headerName = productName ? `注文: ${displayKey} - ${productName}` : `注文: ${displayKey}`
        tasks.push({
          id: `group-order-${key}`,
          name: headerName,
          start: new Date(Math.min(...starts)),
          end: new Date(Math.max(...ends)),
          isGroupHeader: true,
        })
        if (shouldAggregate) {
          aggregateSegments(items, colorMode, 'order').forEach((t) => tasks.push(t))
        } else {
          items.forEach((s) => tasks.push(convertScheduleToTask(s, colorMode, 'order')))
        }
      })
  } else if (groupBy === 'equipment_group') {
    const groups = new Map<string, Schedule[]>()
    schedules.forEach((s) => {
      const key = s.equipment_group_name || '未分類'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(s)
    })

    Array.from(groups.entries())
      .map(([key, items]) => {
        const sorted = sortByStartDate(items)
        const minStart = new Date(
          Math.min(...sorted.map((s) => new Date(s.start_datetime).getTime())),
        )
        return { key, items: sorted, minStart }
      })
      .sort((a, b) => a.minStart.getTime() - b.minStart.getTime())
      .forEach(({ key, items }) => {
        const starts = items.map((s) => new Date(s.start_datetime).getTime())
        const ends = items.map((s) => new Date(s.end_datetime).getTime())
        tasks.push({
          id: `group-equip-${key}`,
          name: `設備グループ: ${key}`,
          start: new Date(Math.min(...starts)),
          end: new Date(Math.max(...ends)),
          isGroupHeader: true,
        })
        items.forEach((s) => tasks.push(convertScheduleToTask(s, colorMode, 'equipment_group')))
      })
  }

  return tasks
}

/**
 * ガントチャート表示コンポーネント（プロダクト固有ラッパー）
 *
 * バックエンドから取得したスケジュールデータを src/gantt の汎用ガントチャートに渡して表示する。
 */
export function GanttChart({
  tasks,
  viewMode = 'Day',
  colorMode = 'product',
  groupBy = 'none',
  currentDate,
  nonWorkingDays,
  onTaskClick,
}: GanttChartProps) {
  // タイムライン表示範囲の計算（表示モードに応じた前後を含む期間）
  const { rangeStart, rangeEnd } = useMemo(() => {
    const refDate = currentDate ?? new Date()
    switch (viewMode) {
      case 'Day':
        // 前日0:00〜翌日23:59（計72時間）
        return {
          rangeStart: startOfDay(addDays(refDate, -1)),
          rangeEnd: endOfDay(addDays(refDate, 1)),
        }
      case 'Week':
        return {
          rangeStart: startOfWeek(refDate, { locale: ja }),
          rangeEnd: endOfWeek(refDate, { locale: ja }),
        }
      case 'Month':
        // 当日を軸として前3日、後31日（計35日）を表示
        return {
          rangeStart: startOfDay(addDays(refDate, -3)),
          rangeEnd: endOfDay(addDays(refDate, 31)),
        }
    }
  }, [currentDate, viewMode])

  const ganttTasks = useMemo(
    () => transformSchedulesToGroupedTasks(tasks, groupBy, colorMode, viewMode),
    [tasks, groupBy, colorMode, viewMode],
  )

  // GanttTask.id → Schedule の逆引きマップ
  const scheduleMap = useMemo(() => {
    const map = new Map<string, Schedule>()
    tasks.forEach((s) => map.set(`schedule-${s.id}`, s))
    return map
  }, [tasks])

  const handleTaskClick = onTaskClick
    ? (task: GanttTask) => {
        const schedule = scheduleMap.get(task.id)
        if (schedule) onTaskClick(schedule)
      }
    : undefined

  if (ganttTasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>スケジュールデータがありません</p>
        </div>
      </div>
    )
  }

  const workHoursForLib = viewMode === 'Week' && nonWorkingDays ? WORK_HOURS : undefined
  const nonWorkingDaysForLib = viewMode === 'Week' ? nonWorkingDays : undefined

  return (
    <GanttChartLib
      tasks={ganttTasks}
      viewMode={viewMode}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
      workHours={workHoursForLib}
      nonWorkingDays={nonWorkingDaysForLib}
      onTaskClick={handleTaskClick}
      wrapTaskBar={(task: GanttTask, children) => (
        <Tooltip>
          <TooltipTrigger asChild>{children}</TooltipTrigger>
          <TooltipContent>
            <p className="font-semibold">{task.name}</p>
            <p>{format(task.start, 'HH:mm', { locale: ja })} - {format(task.end, 'HH:mm', { locale: ja })}</p>
          </TooltipContent>
        </Tooltip>
      )}
    />
  )
}
