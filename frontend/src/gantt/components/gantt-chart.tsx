'use client'

import { useMemo, type ReactNode } from 'react'
import type { GanttTask, GanttViewMode } from '../types'
import {
  buildTimelineConfig,
  getTaskGridColumns,
  getNowFractionalColumn,
} from '../utils/date-math'
import type { WorkHoursConfig } from '../utils/date-math'
import { TimelineHeader } from './timeline-header'
import { TaskBar } from './task-bar'

export interface GanttChartProps {
  /** 表示するタスク一覧 */
  tasks: GanttTask[]
  /** 表示モード */
  viewMode?: GanttViewMode
  /** タイムライン表示開始時刻 */
  rangeStart: Date
  /** タイムライン表示終了時刻 */
  rangeEnd: Date
  /** 行の高さ（px） */
  rowHeight?: number
  /**
   * 稼働時間設定。週次モード時に指定すると非稼働時間帯のグリッドを生成しない。
   * 未指定の場合は 24 時間均一グリッドにフォールバック。
   */
  workHours?: WorkHoursConfig
  /**
   * 非稼働日の Date 配列（祝日・土日等）。週次モード時に指定すると非稼働日の列を生成しない。
   * 未指定の場合は 24 時間均一グリッドにフォールバック。
   */
  nonWorkingDays?: Date[]
  /**
   * タスクバーがクリックされた際に発火するコールバック
   */
  onTaskClick?: (task: GanttTask) => void
  /**
   * タスクバーをラップするレンダー関数（外部からTooltip等を注入する際に使用）。
   * 未指定の場合はバーをそのまま表示する。
   */
  wrapTaskBar?: (task: GanttTask, children: ReactNode) => ReactNode
}

/**
 * 汎用ガントチャートコンポーネント
 *
 * プロダクト固有のドメイン知識を持たない独立したUIコンポーネント。
 * タスクの配置はCSS Gridを利用して時刻から列位置を計算する。
 */
export function GanttChart({
  tasks,
  viewMode = 'Day',
  rangeStart,
  rangeEnd,
  rowHeight = 40,
  workHours,
  nonWorkingDays,
  onTaskClick,
  wrapTaskBar,
}: GanttChartProps) {
  const config = useMemo(
    () => buildTimelineConfig(rangeStart, rangeEnd, viewMode, workHours, nonWorkingDays),
    [rangeStart, rangeEnd, viewMode, workHours, nonWorkingDays],
  )

  const nowFrac = useMemo(() => getNowFractionalColumn(config), [config])

  const { totalUnits, columnWidthPx } = config

  const gridTemplateColumns = columnWidthPx
    ? `repeat(${totalUnits}, ${columnWidthPx}px)`
    : `repeat(${totalUnits}, minmax(0, 1fr))`

  // 現在時刻インジケーターの left 位置
  const nowLeft =
    nowFrac !== null
      ? columnWidthPx
        ? `${(nowFrac - 1) * columnWidthPx}px`
        : `${((nowFrac - 1) / totalUnits) * 100}%`
      : null

  if (tasks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-gray-400 dark:text-gray-500 text-sm">
        スケジュールデータがありません
      </div>
    )
  }

  const minWidth = columnWidthPx ? `${totalUnits * columnWidthPx}px` : '100%'

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <TimelineHeader config={config} viewMode={viewMode} />

        {/* タスク行エリア */}
        <div className="relative">
          {/* 現在時刻インジケーター（縦線） */}
          {nowLeft !== null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
              style={{ left: nowLeft }}
            />
          )}

          {/* タスク行 */}
          {tasks.map((task, index) => {
            const { colStart, colEnd } = getTaskGridColumns(task.start, task.end, config)
            const bar = (
              <TaskBar
                task={task}
                colStart={colStart}
                colEnd={colEnd}
                onClick={onTaskClick && !task.isGroupHeader ? () => onTaskClick(task) : undefined}
              />
            )
            return (
              <div
                key={task.id}
                className="border-b border-gray-100 dark:border-gray-800"
                style={{
                  display: 'grid',
                  gridTemplateColumns,
                  height: `${rowHeight}px`,
                  alignItems: 'center',
                  backgroundColor:
                    index % 2 === 1 ? 'rgba(0,0,0,0.03)' : 'transparent',
                }}
              >
                {wrapTaskBar ? wrapTaskBar(task, bar) : bar}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
