'use client'

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
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
  /** 通常のバー・マイルストーンの高さ（px）。未指定なら 28px */
  barHeight?: number
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
   * タスクバー（グループヘッダーのサマリーバーを含む）がタップ・クリックされた際に発火するコールバック。
   * スクロール（スワイプ）の終わりのクリックでは発火しない
   */
  onTaskClick?: (task: GanttTask) => void
  /**
   * ラベル列の行がタップ・クリックされた際に発火するコールバック（折りたたみのボタンは除く）。
   * 同じ rowId のタスクは1行なので、行のタスクをまとめて受け取る。スワイプの終わりでは発火しない
   */
  onRowClick?: (rowTasks: GanttTask[]) => void
  /** 選択中の行（`getRowKey()` の値）。行をハイライトして、どの行を開いているかを示す */
  selectedRowKeys?: ReadonlySet<string>
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
 * これ以上ポインタが動いた（またはスクロールした）クリックはスワイプの終わりとみなして無視する（px）。
 * タッチのスクロールでは通常クリックは発火しないが、指を止めてから離すと発火するブラウザがある
 */
const TAP_SLOP_PX = 10

/** 行の識別子。同じ rowId のタスクは1行なので rowId、無ければタスクの id */
export function getRowKey(task: Pick<GanttTask, 'id' | 'rowId'>): string {
  return task.rowId ?? task.id
}

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
  barHeight,
  groupRowHeight,
  renderRowLabel,
  labelHeader,
  labelWidth = DEFAULT_LABEL_WIDTH,
  workHours,
  nonWorkingDays,
  onTaskClick,
  onRowClick,
  selectedRowKeys,
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

  // タップとスワイプの区別: ポインタを押した位置とスクロール位置を覚えておき、クリック時に比べる
  const pointerStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    pointerStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el?.scrollLeft ?? 0,
      scrollTop: el?.scrollTop ?? 0,
    }
  }
  const isTap = (e: MouseEvent) => {
    // detail === 0 はキーボード等ポインタ以外からのクリック
    if (e.detail === 0) return true
    const start = pointerStartRef.current
    const el = scrollRef.current
    if (!start || !el) return true
    return (
      Math.abs(e.clientX - start.x) <= TAP_SLOP_PX &&
      Math.abs(e.clientY - start.y) <= TAP_SLOP_PX &&
      el.scrollLeft === start.scrollLeft &&
      el.scrollTop === start.scrollTop
    )
  }

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
    <div ref={scrollRef} className="h-full min-w-0 overflow-auto" onPointerDownCapture={handlePointerDown}>
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
            const rowKey = getRowKey(head)
            const isGroup = head.isGroupHeader === true
            const selected = selectedRowKeys?.has(rowKey) === true
            const height = isGroup ? (groupRowHeight ?? rowHeight) : rowHeight
            // 選択中の行は青く塗る。グループ行は背景を付けて子行と区別する。通常行は縞模様
            const background = selected
              ? 'rgba(37,99,235,0.10)'
              : isGroup
                ? undefined
                : index % 2 === 1
                  ? 'rgba(0,0,0,0.03)'
                  : 'transparent'
            const collapsible = isGroup && onToggleGroup !== undefined && parentIdsWithChildren.has(head.id)
            const collapsed = collapsedGroupIds?.has(head.id) === true
            const labelBackground = selected
              ? 'bg-blue-50 shadow-[inset_4px_0_0_0_#2563eb] dark:bg-blue-950'
              : isGroup
                ? 'bg-gray-100 dark:bg-gray-800'
                : 'bg-white dark:bg-gray-900'
            const labelContent = renderRowLabel ? renderRowLabel(rowTasks) : head.name
            return (
              <div
                key={rowKey}
                data-group-row={isGroup || undefined}
                data-selected={selected || undefined}
                className={`flex border-b border-gray-100 dark:border-gray-800${isGroup ? ' bg-gray-50 dark:bg-gray-800/60' : ''}`}
                style={{ height: `${height}px`, backgroundColor: background }}
              >
                {/* ラベルセル: 左に固定。背景を塗らないと下を流れるバーが透ける。子行はインデントする */}
                <div
                  data-testid="gantt-row-label"
                  style={labelCellStyle}
                  className={`sticky left-0 z-10 flex shrink-0 items-center gap-1 overflow-hidden border-r border-gray-200 text-xs dark:border-gray-700 ${labelBackground} ${
                    isGroup ? 'px-1' : head.parentId !== undefined ? 'pl-7 pr-2' : 'px-2'
                  }`}
                >
                  {collapsible && (
                    <button
                      type="button"
                      onClick={() => onToggleGroup?.(head.id)}
                      aria-expanded={!collapsed}
                      aria-label={collapsed ? '展開する' : '折りたたむ'}
                      className="flex h-11 w-8 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
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
                  {onRowClick ? (
                    // 行の高さいっぱいをタップ範囲にする。中に折りたたみのボタンを入れないので role="button" にできる
                    <div
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected}
                      onClick={(e) => {
                        if (isTap(e)) onRowClick(rowTasks)
                      }}
                      onKeyDown={(e: KeyboardEvent) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return
                        e.preventDefault()
                        onRowClick(rowTasks)
                      }}
                      className="flex min-w-0 flex-1 cursor-pointer items-center self-stretch break-words focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
                    >
                      <div className="min-w-0 flex-1">{labelContent}</div>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1 break-words">{labelContent}</div>
                  )}
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
                        style={{
                          gridRow: 1,
                          ...(barHeight !== undefined && !task.isGroupHeader ? { height: `${barHeight}px` } : {}),
                        }}
                        onClick={
                          onTaskClick && !task.isGhost
                            ? (e: MouseEvent) => {
                                if (isTap(e)) onTaskClick(task)
                              }
                            : undefined
                        }
                      />
                    )
                    return wrapTaskBar && !task.isGhost ? (
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
