'use client'

import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { GanttTask, GanttViewMode } from '../types'
import {
  buildTimelineConfig,
  getTaskGridColumns,
  getMilestoneGridColumn,
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
  /** 通常行の高さ（px） */
  rowHeight?: number
  /** グループ行（isGroupHeader）の高さ（px）。未指定なら rowHeight と同じ */
  groupRowHeight?: number
  /**
   * 固定ラベル列の各行の中身を描く関数。同じ rowId のタスクは1行なので、行のタスクをまとめて受け取る。
   * 未指定なら行の先頭タスクの name を出す
   */
  renderRowLabel?: (rowTasks: GanttTask[]) => ReactNode
  /** ラベル列の見出し（左上の角セルの中身） */
  labelHeader?: ReactNode
  /** ラベル列の幅（px） */
  labelWidth?: number
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

/** ラベル列の既定幅（px）。1180px 級のタブレット横向きでもタイムラインが残る幅 */
const DEFAULT_LABEL_WIDTH = 260

/**
 * 汎用ガントチャートコンポーネント
 *
 * プロダクト固有のドメイン知識を持たない独立したUIコンポーネント。
 * タスクの配置はCSS Gridを利用して時刻から列位置を計算する。
 *
 * 左に固定のラベル列・右にタイムラインを置き、ヘッダーと全行を1つのスクロールコンテナ（親の高さに
 * 収まる overflow: auto）に入れる。日付ヘッダーは sticky top、ラベル列は sticky left、左上の角は両方向に
 * 固定するので、縦横のスクロール同期は要らない。親には高さ（h-full が効く高さ）を与えること
 */
export function GanttChart({
  tasks,
  viewMode = 'Day',
  rangeStart,
  rangeEnd,
  rowHeight = 40,
  groupRowHeight,
  renderRowLabel,
  labelHeader,
  labelWidth = DEFAULT_LABEL_WIDTH,
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

  const rows = useMemo(() => groupTasksIntoRows(tasks), [tasks])

  const { totalUnits, columnWidthPx } = config

  // 日次（列幅固定で横にあふれる）を開いたら現在時刻付近へ横スクロールを合わせる
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasTasks = tasks.length > 0
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !columnWidthPx || nowFrac === null) return
    const nowPx = (nowFrac - 1) * columnWidthPx
    const visibleTimelineWidth = el.clientWidth - labelWidth
    el.scrollLeft = Math.max(0, nowPx - visibleTimelineWidth / 2)
  }, [columnWidthPx, nowFrac, labelWidth, hasTasks])

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

  const timelineMinWidth = columnWidthPx ? totalUnits * columnWidthPx : 0
  const labelCellStyle = { width: `${labelWidth}px`, minWidth: `${labelWidth}px` }

  return (
    <div ref={scrollRef} className="h-full min-w-0 overflow-auto">
      <div style={{ minWidth: `${labelWidth + timelineMinWidth}px` }}>
        {/* ヘッダー行: 上に固定。左上の角は左にも固定 */}
        <div className="sticky top-0 z-30 flex">
          <div
            data-testid="gantt-label-header"
            style={labelCellStyle}
            className="sticky left-0 z-30 flex shrink-0 items-center border-b border-r border-gray-200 bg-gray-50 px-2 text-xs font-semibold dark:border-gray-700 dark:bg-gray-800"
          >
            {labelHeader}
          </div>
          <div className="min-w-0 flex-1">
            <TimelineHeader config={config} viewMode={viewMode} />
          </div>
        </div>

        {/* タスク行エリア */}
        <div className="relative">
          {/* 現在時刻インジケーター（縦線）。タイムライン列の上にだけ重ねる */}
          {nowLeft !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 right-0 z-[5]"
              style={{ left: `${labelWidth}px` }}
            >
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500"
                style={{ left: nowLeft }}
              />
            </div>
          )}

          {/* タスク行（同じ rowId のタスクは1行に並べる） */}
          {rows.map((rowTasks, index) => {
            const height = rowTasks[0].isGroupHeader ? (groupRowHeight ?? rowHeight) : rowHeight
            const stripe = index % 2 === 1 ? 'rgba(0,0,0,0.03)' : 'transparent'
            return (
              <div
                key={rowTasks[0].rowId ?? rowTasks[0].id}
                className="flex border-b border-gray-100 dark:border-gray-800"
                style={{ height: `${height}px`, backgroundColor: stripe }}
              >
                {/* ラベルセル: 左に固定。背景を塗らないと下を流れるバーが透ける */}
                <div
                  data-testid="gantt-row-label"
                  style={labelCellStyle}
                  className="sticky left-0 z-10 flex shrink-0 items-center overflow-hidden border-r border-gray-200 bg-white px-2 text-xs dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="min-w-0 break-words">
                    {renderRowLabel ? renderRowLabel(rowTasks) : rowTasks[0].name}
                  </div>
                </div>
                <div
                  className="min-w-0 flex-1"
                  style={{ display: 'grid', gridTemplateColumns, alignItems: 'center' }}
                >
                  {rowTasks.map((task) => {
                    const isMilestone = !task.isGroupHeader && task.isMilestone === true
                    const milestoneCol = isMilestone
                      ? getMilestoneGridColumn(task.start, config)
                      : null
                    const { colStart, colEnd } =
                      milestoneCol !== null
                        ? { colStart: milestoneCol, colEnd: milestoneCol + 1 }
                        : getTaskGridColumns(task.start, task.end, config)
                    const bar = (
                      <TaskBar
                        key={task.id}
                        task={task}
                        colStart={colStart}
                        colEnd={colEnd}
                        style={{ gridRow: 1 }}
                        onClick={
                          onTaskClick && !task.isGroupHeader ? () => onTaskClick(task) : undefined
                        }
                      />
                    )
                    return wrapTaskBar ? (
                      <Fragment key={task.id}>{wrapTaskBar(task, bar)}</Fragment>
                    ) : (
                      bar
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * タスクを描画する行に分ける。rowId が同じタスクは最初に現れた位置の行にまとめ、
 * rowId の無いタスクは1タスク1行にする（行の順序はタスクの並び順を保つ）
 */
export function groupTasksIntoRows(tasks: GanttTask[]): GanttTask[][] {
  const rows: GanttTask[][] = []
  const rowIndexById = new Map<string, number>()
  tasks.forEach((task) => {
    if (task.rowId === undefined) {
      rows.push([task])
      return
    }
    const existing = rowIndexById.get(task.rowId)
    if (existing !== undefined) {
      rows[existing].push(task)
      return
    }
    rowIndexById.set(task.rowId, rows.length)
    rows.push([task])
  })
  return rows
}
