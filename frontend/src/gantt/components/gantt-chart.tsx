'use client'

import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { GanttMarker, GanttTask, GanttViewMode } from '../types'
import {
  buildTimelineConfig,
  getTaskGridColumns,
  getMilestoneGridColumn,
  getNowFractionalColumn,
  getFractionalColumn,
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
  /** 折りたたみ中のグループヘッダーの id。子行（parentId がこの id のタスクの行）を隠す */
  collapsedGroupIds?: ReadonlySet<string>
  /**
   * グループヘッダーの折りたたみ／展開を切り替えるコールバック。指定すると、子行のあるグループ行の
   * ラベルに切り替えボタンを出す
   */
  onToggleGroup?: (groupId: string) => void
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
  collapsedGroupIds,
  onToggleGroup,
}: GanttChartProps) {
  const config = useMemo(
    () => buildTimelineConfig(rangeStart, rangeEnd, viewMode, workHours, nonWorkingDays),
    [rangeStart, rangeEnd, viewMode, workHours, nonWorkingDays],
  )

  const nowFrac = useMemo(() => getNowFractionalColumn(config), [config])

  const allRows = useMemo(() => groupTasksIntoRows(tasks), [tasks])
  const parentIdsWithChildren = useMemo(
    () => new Set(tasks.flatMap((t) => (t.parentId !== undefined ? [t.parentId] : []))),
    [tasks],
  )
  const rows = useMemo(
    () =>
      collapsedGroupIds && collapsedGroupIds.size > 0
        ? allRows.filter((rowTasks) => {
            const parentId = rowTasks[0].parentId
            return parentId === undefined || !collapsedGroupIds.has(parentId)
          })
        : allRows,
    [allRows, collapsedGroupIds],
  )

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
            const head = rowTasks[0]
            const isGroup = head.isGroupHeader === true
            const height = isGroup ? (groupRowHeight ?? rowHeight) : rowHeight
            // グループ行は背景を付けて子行と区別する。通常行は縞模様
            const background = isGroup
              ? undefined
              : index % 2 === 1
                ? 'rgba(0,0,0,0.03)'
                : 'transparent'
            const collapsible = isGroup && onToggleGroup !== undefined && parentIdsWithChildren.has(head.id)
            const collapsed = collapsedGroupIds?.has(head.id) === true
            return (
              <div
                key={head.rowId ?? head.id}
                data-group-row={isGroup || undefined}
                className={`flex border-b border-gray-100 dark:border-gray-800${isGroup ? ' bg-gray-50 dark:bg-gray-800/60' : ''}`}
                style={{ height: `${height}px`, backgroundColor: background }}
              >
                {/* ラベルセル: 左に固定。背景を塗らないと下を流れるバーが透ける。子行はインデントする */}
                <div
                  data-testid="gantt-row-label"
                  style={labelCellStyle}
                  className={`sticky left-0 z-10 flex shrink-0 items-center gap-1 overflow-hidden border-r border-gray-200 text-xs dark:border-gray-700 ${
                    isGroup
                      ? 'bg-gray-100 px-1 dark:bg-gray-800'
                      : `bg-white dark:bg-gray-900 ${head.parentId !== undefined ? 'pl-7 pr-2' : 'px-2'}`
                  }`}
                >
                  {collapsible && (
                    <button
                      type="button"
                      onClick={() => onToggleGroup?.(head.id)}
                      aria-expanded={!collapsed}
                      aria-label={collapsed ? '展開する' : '折りたたむ'}
                      className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
                    >
                      <svg
                        aria-hidden
                        viewBox="0 0 16 16"
                        className={`h-3 w-3 transition-transform${collapsed ? ' -rotate-90' : ''}`}
                      >
                        <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" />
                      </svg>
                    </button>
                  )}
                  <div className="min-w-0 flex-1 break-words">
                    {renderRowLabel ? renderRowLabel(rowTasks) : head.name}
                  </div>
                </div>
                <div
                  className="relative min-w-0 flex-1"
                  style={{ display: 'grid', gridTemplateColumns, alignItems: 'center' }}
                >
                  {head.markers?.map((marker) => (
                    <MarkerLine
                      key={`${marker.label}-${marker.at.getTime()}`}
                      marker={marker}
                      config={config}
                      toLeft={(frac) =>
                        columnWidthPx
                          ? `${(frac - 1) * columnWidthPx}px`
                          : `${((frac - 1) / totalUnits) * 100}%`
                      }
                    />
                  ))}
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
 * 行のタイムラインに重ねる縦線の目印。表示範囲の外なら端に `→ label` / `← label` を出す。
 * バーのクリック・ホバーを邪魔しないよう pointer-events は切る
 */
function MarkerLine({
  marker,
  config,
  toLeft,
}: {
  marker: GanttMarker
  config: ReturnType<typeof buildTimelineConfig>
  toLeft: (fractionalColumn: number) => string
}) {
  const danger = marker.tone === 'danger'
  const color = danger ? 'text-red-600 dark:text-red-400' : 'text-blue-700 dark:text-blue-300'
  const lineColor = danger ? 'bg-red-600 dark:bg-red-400' : 'bg-blue-700 dark:bg-blue-300'
  const frac = getFractionalColumn(config, marker.at)

  if (frac === null) {
    const before = marker.at.getTime() < config.rangeStart.getTime()
    return (
      <span
        data-testid="gantt-marker-edge"
        data-marker-side={before ? 'before' : 'after'}
        className={`pointer-events-none absolute top-0 z-[3] rounded bg-white/90 px-1 text-[10px] font-semibold leading-4 dark:bg-gray-900/90 ${color} ${before ? 'left-0' : 'right-0'}`}
      >
        {before ? `← ${marker.label}` : `→ ${marker.label}`}
      </span>
    )
  }

  return (
    <div
      data-testid="gantt-marker"
      className="pointer-events-none absolute inset-y-0 z-[3]"
      style={{ left: toLeft(frac) }}
    >
      <span aria-hidden className={`absolute inset-y-0 w-0.5 -translate-x-1/2 ${lineColor}`} />
      <span
        className={`absolute top-0 left-0.5 whitespace-nowrap rounded bg-white/90 px-1 text-[10px] font-semibold leading-4 dark:bg-gray-900/90 ${color}`}
      >
        ⚑ {marker.label}
      </span>
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
