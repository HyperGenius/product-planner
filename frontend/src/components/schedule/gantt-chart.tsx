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
  isSameDay,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import { GanttChart as GanttChartLib } from '@/gantt'
import type { GanttTask } from '@/gantt'
import type { Schedule, GanttViewMode, GroupByMode } from '@/types/schedule'
import type { ProcessProgress } from '@/types/daily-report-progress'
import {
  formatActualDateRange,
  formatProgressQuantity,
  indexProgress,
  isProgressDelayed,
  progressKey,
  progressRatio,
  progressStatusLabel,
} from '@/lib/daily-report-progress-utils'
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
  /**
   * 日報の実績による受注×工程の進捗（Issue #491）。指定するとバーに進捗率の塗り・遅れの強調を付け、
   * ツールチップに実績を出す。進捗の行が無い工程（割り付けの対象外の受注等）は現状どおりの表示
   */
  progress?: readonly ProcessProgress[]
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

  const start = new Date(schedule.start_datetime)
  const end = new Date(schedule.end_datetime)

  return {
    id: `schedule-${schedule.id}`,
    name,
    start,
    end,
    color: getBarColor(schedule, colorMode),
    isMilestone: start.getTime() === end.getTime(),
  }
}

/**
 * 週次モード用: 同じ受注・工程（process_routing_id）のセグメントを1行に並べる。
 *
 * スケジューラは1工程を日・休憩・既存スケジュールの隙間ごとのセグメントに分けるので、
 * 1本のバー（先頭の開始〜最後の終了）にまとめると間の空き時間まで作業中に見える（Issue #535）。
 * バーはセグメントごとに描き、行だけをまとめる。ラベルは行の右端（最後のセグメント）にだけ出す。
 * 工程名ではなく process_routing_id で束ねるのは、同じ工程名がルーティングに2回ある場合に
 * 別の工程を1行に合体させないため
 */
function segmentRowTasks(
  schedules: Schedule[],
  colorMode: 'product' | 'process',
  groupBy: GroupByMode,
): GanttTask[] {
  const groups = new Map<string, Schedule[]>()
  schedules.forEach((s) => {
    const key = `${s.order_id}__${s.process_routing_id}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  })

  const result: GanttTask[] = []
  groups.forEach((items, key) => {
    const sorted = [...items].sort(
      (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime(),
    )
    sorted.forEach((s, i) => {
      result.push({
        ...convertScheduleToTask(s, colorMode, groupBy),
        rowId: `segments-${key}`,
        hideLabel: i < sorted.length - 1,
      })
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

  // 週次は行数を抑えるため、同じ工程のセグメントを1行に並べる（日次・月次は1セグメント1行）
  const shouldShareRows = viewMode === 'Week'

  if (groupBy === 'none') {
    const sorted = sortByStartDate(schedules)
    if (shouldShareRows) {
      return segmentRowTasks(sorted, colorMode, 'none')
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
        if (shouldShareRows) {
          segmentRowTasks(items, colorMode, 'order').forEach((t) => tasks.push(t))
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
 * バーに進捗率・遅れを載せる。進捗は工程単位なので、工程が複数のセグメントに分かれる場合は
 * 各セグメントのバーに同じ進捗を出す
 */
function applyProgress(
  tasks: GanttTask[],
  scheduleMap: Map<string, Schedule>,
  progressIndex: Map<string, ProcessProgress>,
  now: Date,
): GanttTask[] {
  if (progressIndex.size === 0) return tasks
  return tasks.map((task) => {
    if (task.isGroupHeader) return task
    const schedule = scheduleMap.get(task.id)
    const progress = schedule
      ? progressIndex.get(progressKey(schedule.order_id, schedule.process_routing_id))
      : undefined
    if (!progress) return task
    return {
      ...task,
      progress: progressRatio(progress) ?? undefined,
      isDelayed: isProgressDelayed(progress, now),
    }
  })
}

function formatDateTime(d: Date): string {
  return format(d, 'M/d HH:mm', { locale: ja })
}

/** 期間を日付付きで出す（同じ日なら終了は時刻だけ）。週次で複数日にわたる範囲を1日分に見せないため */
function formatRange(start: Date, end: Date): string {
  const endLabel = isSameDay(start, end) ? format(end, 'HH:mm', { locale: ja }) : formatDateTime(end)
  return `${formatDateTime(start)} - ${endLabel}`
}

/** 同じ行に並ぶセグメントの数と表示中の範囲（Issue #535） */
interface RowSummary {
  count: number
  start: Date
  end: Date
}

/** タスク ID → そのタスクが並ぶ行のセグメントの要約。セグメントが1つだけの行は含めない */
function summarizeRows(tasks: GanttTask[]): Map<string, RowSummary> {
  const byRow = new Map<string, GanttTask[]>()
  tasks.forEach((t) => {
    if (t.rowId === undefined) return
    if (!byRow.has(t.rowId)) byRow.set(t.rowId, [])
    byRow.get(t.rowId)!.push(t)
  })
  const result = new Map<string, RowSummary>()
  byRow.forEach((items) => {
    if (items.length < 2) return
    const summary: RowSummary = {
      count: items.length,
      start: new Date(Math.min(...items.map((t) => t.start.getTime()))),
      end: new Date(Math.max(...items.map((t) => t.end.getTime()))),
    }
    items.forEach((t) => result.set(t.id, summary))
  })
  return result
}

/** 工程が複数のセグメントに分かれているとき、ツールチップに工程全体（表示中の範囲）を出す */
function RowSegmentsTooltipLine({ summary }: { summary: RowSummary | undefined }) {
  if (!summary) return null
  return (
    <p>
      この工程（表示中）: {formatRange(summary.start, summary.end)}（{summary.count}区間）
    </p>
  )
}

/** ツールチップの進捗の行（実績数量・初回／最終実績日・状態） */
function ProgressTooltipLines({ progress, delayed }: { progress: ProcessProgress; delayed: boolean }) {
  const ratio = progressRatio(progress)
  const dateRange = formatActualDateRange(progress)
  return (
    <div className="mt-1 border-t border-background/30 pt-1">
      <p>
        状態: {progressStatusLabel(progress)}
        {delayed && <span className="ml-1 font-semibold">（遅れ）</span>}
      </p>
      <p>
        実績: {formatProgressQuantity(progress)}
        {ratio !== null && progress.status !== 'completed' && ` (${Math.round(ratio * 100)}%)`}
      </p>
      {dateRange && <p>実績日: {dateRange}</p>}
      {delayed && progress.planned_end_datetime && (
        <p>
          計画終了: {format(new Date(progress.planned_end_datetime), 'M/d HH:mm', { locale: ja })}
        </p>
      )}
    </div>
  )
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
  progress,
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

  // GanttTask.id → Schedule の逆引きマップ
  const scheduleMap = useMemo(() => {
    const map = new Map<string, Schedule>()
    tasks.forEach((s) => map.set(`schedule-${s.id}`, s))
    return map
  }, [tasks])

  const progressIndex = useMemo(() => indexProgress(progress), [progress])

  const ganttTasks = useMemo(
    () =>
      applyProgress(
        transformSchedulesToGroupedTasks(tasks, groupBy, colorMode, viewMode),
        scheduleMap,
        progressIndex,
        new Date(),
      ),
    [tasks, groupBy, colorMode, viewMode, scheduleMap, progressIndex],
  )

  const rowSummaries = useMemo(() => summarizeRows(ganttTasks), [ganttTasks])

  const progressOf = (task: GanttTask): ProcessProgress | undefined => {
    const schedule = scheduleMap.get(task.id)
    return schedule
      ? progressIndex.get(progressKey(schedule.order_id, schedule.process_routing_id))
      : undefined
  }

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
      wrapTaskBar={(task: GanttTask, children) => {
        const taskProgress = task.isGroupHeader ? undefined : progressOf(task)
        return (
          <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold">{task.name}</p>
              <p>{task.isMilestone ? formatDateTime(task.start) : formatRange(task.start, task.end)}</p>
              {!task.isGroupHeader && <RowSegmentsTooltipLine summary={rowSummaries.get(task.id)} />}
              {taskProgress && (
                <ProgressTooltipLines progress={taskProgress} delayed={task.isDelayed === true} />
              )}
            </TooltipContent>
          </Tooltip>
        )
      }}
    />
  )
}
