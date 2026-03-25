/* frontend/src/components/schedule/gantt-chart.tsx */
'use client'

import { useMemo } from 'react'
import {
  addDays,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import { GanttChart as GanttChartLib } from '@/gantt'
import type { GanttTask } from '@/gantt'
import type { Schedule, GanttViewMode, GroupByMode } from '@/types/schedule'

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
}

/**
 * スケジュールに基づいてバーの色を決定する
 */
function getBarColor(schedule: Schedule, colorMode: 'product' | 'process'): string {
  if (colorMode === 'product') {
    // 製品名に基づいて色を決定（ハッシュから生成）
    const productName = schedule.product_name || 'default'
    const hash = productName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const hue = hash % 360
    return `hsl(${hue}, 70%, 50%)`
  }

  // 工程名に基づいて色を決定
  const processColors: Record<string, string> = {
    '切削': '#ef4444', // red-500
    '組立': '#3b82f6', // blue-500
    '検査': '#10b981', // green-500
    '塗装': '#f59e0b', // amber-500
    '梱包': '#8b5cf6', // violet-500
    default: '#6b7280', // gray-500
  }
  return processColors[schedule.process_name || 'default'] ?? processColors['default']
}

/**
 * Schedule型からGanttTask型に変換するユーティリティ関数
 */
export function convertScheduleToTask(
  schedule: Schedule,
  colorMode: 'product' | 'process' = 'product',
): GanttTask {
  return {
    id: `schedule-${schedule.id}`,
    name: `${schedule.process_name || '工程'} - ${schedule.order_number || ''}`,
    start: new Date(schedule.start_datetime),
    end: new Date(schedule.end_datetime),
    color: getBarColor(schedule, colorMode),
  }
}

/**
 * スケジュールをグルーピングモードに応じてGanttTask配列に変換する
 */
function transformSchedulesToGroupedTasks(
  schedules: Schedule[],
  groupBy: GroupByMode,
  colorMode: 'product' | 'process',
): GanttTask[] {
  const sortByStartDate = (items: Schedule[]) =>
    [...items].sort(
      (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime(),
    )

  if (groupBy === 'none') {
    return sortByStartDate(schedules).map((s) => convertScheduleToTask(s, colorMode))
  }

  const tasks: GanttTask[] = []

  if (groupBy === 'order') {
    const groups = new Map<string, Schedule[]>()
    schedules.forEach((s) => {
      const key = s.order_number || 'Unknown'
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
        const productName = items[0]?.product_name || ''
        tasks.push({
          id: `group-order-${key}`,
          name: `注文: ${key} - ${productName}`,
          start: new Date(Math.min(...starts)),
          end: new Date(Math.max(...ends)),
          isGroupHeader: true,
        })
        items.forEach((s) => tasks.push(convertScheduleToTask(s, colorMode)))
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
        items.forEach((s) => tasks.push(convertScheduleToTask(s, colorMode)))
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
        // 当日を軸として前後30日（計61日）を表示
        return {
          rangeStart: startOfDay(addDays(refDate, -30)),
          rangeEnd: endOfDay(addDays(refDate, 30)),
        }
    }
  }, [currentDate, viewMode])

  const ganttTasks = useMemo(
    () => transformSchedulesToGroupedTasks(tasks, groupBy, colorMode),
    [tasks, groupBy, colorMode],
  )

  if (ganttTasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p>スケジュールデータがありません</p>
        </div>
      </div>
    )
  }

  return (
    <GanttChartLib
      tasks={ganttTasks}
      viewMode={viewMode}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
    />
  )
}
