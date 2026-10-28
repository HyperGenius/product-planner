/* frontend/src/components/schedule/gantt-chart.tsx */
'use client'

import { useMemo, useState } from 'react'
import {
  addDays,
  parseISO,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  format,
} from 'date-fns'
import { ja } from 'date-fns/locale'
import { GanttChart as GanttChartLib, getRowKey } from '@/gantt'
import type { GanttBarAppearance, GanttMarker, GanttTask } from '@/gantt'
import type { Schedule, GanttViewMode, GroupByMode } from '@/types/schedule'
import type { ProcessProgress } from '@/types/daily-report-progress'
import type { ProcessShiftResult } from '@/types/schedule-shift'
import {
  formatActualDateRange,
  formatProgressQuantity,
  indexProgress,
  orderStateLabelText,
  processDisplayState,
  processStateBadge,
  processStateLabelText,
  progressKey,
  progressRatio,
  progressStatusLabel,
} from '@/lib/daily-report-progress-utils'
import type { ProcessDisplayState } from '@/lib/daily-report-progress-utils'
import { pickShippingDeadline } from '@/lib/shipping-candidate-utils'
import {
  isDeadlineExceeded,
  scheduleCustomerLabel,
  scheduleOrderMeta,
  scheduleOrderTitle,
  scheduleQuantityLabel,
} from '@/lib/schedule-label-utils'
import { formatDateTime, formatRange, type ScheduleSelection } from '@/lib/schedule-detail-utils'
import { DeadlineExceededIcon, StateIcon, type StateBadgeState } from '@/components/schedule/state-badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ChevronsDownUp, ChevronsUpDown } from 'lucide-react'

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
   * 詳細シートで開いている工程・注文（Issue #581）。その行をハイライトする
   */
  selection?: ScheduleSelection | null
  /**
   * 工程バー・工程行のラベル（→ 工程）、注文行のラベル・サマリーバー（→ 注文）をタップしたときのコールバック。
   * 設備グループ行のラベルのタップは折りたたみの切り替え
   */
  onSelect?: (selection: ScheduleSelection) => void
  /** 折りたたみ中のグループ行の id（制御する場合。未指定なら内部で持つ） */
  collapsedGroupIds?: ReadonlySet<string>
  onCollapsedGroupIdsChange?: (ids: ReadonlySet<string>) => void
  /**
   * 日報の実績による受注×工程の進捗（Issue #491）。指定するとバーに進捗率の塗り・遅れの強調を付け、
   * ツールチップに実績を出す。進捗の行が無い工程（割り付けの対象外の受注等）は現状どおりの表示
   */
  progress?: readonly ProcessProgress[]
  /**
   * 工程の前倒し・後ろ倒しのプレビュー（Issue #582）。動く工程の元のバーを薄くし、ずらした後のバーを
   * 同じ行に重ねて描く
   */
  shiftPreview?: ProcessShiftResult | null
}

/** バーの基本色（未着手の枠・進行中の塗り） */
const BASE_BAR_COLOR = '#2563eb'

/**
 * スケジュールに基づいてバーの色を決定する
 */
function getBarColor(schedule: Schedule, colorMode: 'product' | 'process'): string {
  // 製品の識別はラベル列が担うので、バーの色は状態（外観）で塗り分ける。基本色は固定の青（Issue #580）
  if (colorMode === 'product') return BASE_BAR_COLOR

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
 * Schedule型からGanttTask型に変換するユーティリティ関数
 */
export function convertScheduleToTask(
  schedule: Schedule,
  colorMode: 'product' | 'process' = 'product',
  groupBy: GroupByMode = 'none',
): GanttTask {
  const processName = schedule.process_name || '工程'
  // ツールチップの見出しに使う。オーダー別は工程と設備、それ以外はどの注文の工程か
  const name =
    groupBy === 'order'
      ? [processName, schedule.equipment_group_name].filter(Boolean).join(' - ')
      : `${processName}（${scheduleOrderTitle(schedule)}）`

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

/** ラベル列の1行分の中身 */
export type RowLabel =
  /**
   * 注文行: 1行目 = 顧客の通称（太字）＋状態アイコン、2行目 = 製品名・数量（Issue #589）。
   * 納期は納期マーカー、注文番号は詳細シートで見るのでラベルに出さない
   */
  | {
      kind: 'order'
      orderId: number
      customer: string
      isUnknownCustomer: boolean
      product: string | null
      quantity: string | null
      /** サマリーバーのツールチップ（数量・納期・注文番号） */
      meta: string[]
      /** 最後の工程の計画終了が希望納期を超えている */
      deadlineExceeded: boolean
    }
  /** 設備グループ行 */
  | { kind: 'group'; title: string }
  /** 工程行: 1行目 = primary、2行目 = secondary（小さく） */
  | { kind: 'process'; primary: string; secondary: string | null }

/** ガントに渡すタスクと、行の先頭タスクの id → ラベルの中身 */
export interface ScheduleGanttModel {
  tasks: GanttTask[]
  labels: Map<string, RowLabel>
  /** 折りたためるグループ行（注文・設備グループ）の id */
  groupIds: string[]
}

interface TimeRange {
  start: Date
  end: Date
}

/** 注文行のサマリーバーの色。工程のバー（製品・工程ごとの色）と区別するため無彩色にする */
const SUMMARY_BAR_COLOR = '#4b5563'

const toTime = (iso: string) => new Date(iso).getTime()
const byStart = (a: Schedule, b: Schedule) => toTime(a.start_datetime) - toTime(b.start_datetime)

/**
 * 工程の行を作る。
 *
 * 週次・月次（shareRows）は同じ受注・工程（process_routing_id）のセグメントを1行に並べる。
 * スケジューラは1工程を日・休憩・既存スケジュールの隙間ごとのセグメントに分けるので、
 * 1本のバー（先頭の開始〜最後の終了）にまとめると間の空き時間まで作業中に見える（Issue #535）。
 * 工程名ではなく process_routing_id で束ねるのは、同じ工程名がルーティングに2回ある場合に
 * 別の工程を1行に合体させないため。日次は1セグメント1行。
 *
 * 行の工程（セグメント1つの行はそのセグメント）が表示範囲の外へ続くなら、行の最初・最後のバーに
 * 「続き」の印を付ける。工程全体の範囲は API の process_start/end_datetime（期間外のセグメントを含む）
 */
function buildProcessRows(
  schedules: Schedule[],
  options: {
    colorMode: 'product' | 'process'
    groupBy: GroupByMode
    shareRows: boolean
    range: TimeRange
    parentId?: string
    compareRows: (a: Schedule, b: Schedule) => number
    label: (schedule: Schedule) => RowLabel
  },
): { tasks: GanttTask[]; labels: Map<string, RowLabel> } {
  const rowsByKey = new Map<string, Schedule[]>()
  schedules.forEach((s) => {
    const key = options.shareRows ? `${s.order_id}__${s.process_routing_id}` : `schedule-${s.id}`
    if (!rowsByKey.has(key)) rowsByKey.set(key, [])
    rowsByKey.get(key)!.push(s)
  })

  const rows = Array.from(rowsByKey.entries())
    .map(([key, items]) => ({ key, items: [...items].sort(byStart) }))
    .sort((a, b) => options.compareRows(a.items[0], b.items[0]))

  const tasks: GanttTask[] = []
  const labels = new Map<string, RowLabel>()
  rows.forEach(({ key, items }) => {
    const first = items[0]
    const last = items.reduce((latest, s) => (toTime(s.end_datetime) > toTime(latest.end_datetime) ? s : latest))
    const rowStart = options.shareRows ? (first.process_start_datetime ?? first.start_datetime) : first.start_datetime
    const rowEnd = options.shareRows ? (last.process_end_datetime ?? last.end_datetime) : last.end_datetime
    const continuesBefore = toTime(rowStart) < options.range.start.getTime()
    const continuesAfter = toTime(rowEnd) > options.range.end.getTime()

    items.forEach((s) => {
      tasks.push({
        ...convertScheduleToTask(s, options.colorMode, options.groupBy),
        ...(options.shareRows ? { rowId: `segments-${key}` } : {}),
        ...(options.parentId !== undefined ? { parentId: options.parentId } : {}),
        ...(s === first && continuesBefore ? { continuesBefore: true } : {}),
        ...(s === last && continuesAfter ? { continuesAfter: true } : {}),
      })
    })
    labels.set(`schedule-${first.id}`, options.label(first))
  })
  return { tasks, labels }
}

/**
 * 注文行の納期マーカー（希望納期 → 無ければ完成見込み。#579 と同じ基準）。
 * 納期の日の終わりに線を引く。最後の工程の計画終了が希望納期の日を超えていれば超過（赤）。
 * 完成見込みは計画の終了から算出した値なので、超過の判定は希望納期があるときだけ行う
 */
function orderDeadline(
  head: Schedule,
  orderEnd: Date,
): { marker: GanttMarker; exceeded: boolean } | null {
  const deadline = pickShippingDeadline(head.desired_deadline, head.confirmed_deadline)
  if (!deadline) return null
  // 日付のみの値は parseISO でローカル深夜として読む（new Date だと UTC 深夜になり日付がずれる）
  const day = parseISO(deadline.date)
  const exceeded = isDeadlineExceeded(head, orderEnd)
  return {
    exceeded,
    marker: {
      at: addDays(day, 1),
      label: `${deadline.source === 'desired' ? '納期' : '見込'} ${format(day, 'M/d')}`,
      tone: exceeded ? 'danger' : 'default',
    },
  }
}

/** 工程行のラベル（フラット・設備グループ別）: どの注文の工程か */
function processWithOrderLabel(s: Schedule): RowLabel {
  return { kind: 'process', primary: scheduleOrderTitle(s), secondary: s.process_name || '工程' }
}

/** 工程行のラベル（オーダー別）: 工程名と設備（グループ）の表示名 */
function processWithEquipmentLabel(s: Schedule): RowLabel {
  return { kind: 'process', primary: s.process_name || '工程', secondary: s.equipment_group_name ?? null }
}

/** オーダー別の工程の並び: 工程順（sequence_order）→ 開始日時 */
function compareBySequence(a: Schedule, b: Schedule): number {
  const seq = (a.sequence_order ?? Number.MAX_SAFE_INTEGER) - (b.sequence_order ?? Number.MAX_SAFE_INTEGER)
  return seq !== 0 ? seq : byStart(a, b)
}

/** キーごとにまとめ、表示中の最初の開始が早い順に並べる */
function groupByKey<K>(schedules: Schedule[], keyOf: (s: Schedule) => K): Schedule[][] {
  const groups = new Map<K, Schedule[]>()
  schedules.forEach((s) => {
    const key = keyOf(s)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(s)
  })
  return Array.from(groups.values())
    .map((items) => [...items].sort(byStart))
    .sort((a, b) => byStart(a[0], b[0]))
}

function visibleExtent(items: Schedule[]): TimeRange {
  return {
    start: new Date(Math.min(...items.map((s) => toTime(s.start_datetime)))),
    end: new Date(Math.max(...items.map((s) => toTime(s.end_datetime)))),
  }
}

/**
 * スケジュールをグルーピングモードに応じて GanttTask とラベルに変換する
 */
export function buildScheduleGanttModel(
  schedules: Schedule[],
  groupBy: GroupByMode,
  colorMode: 'product' | 'process',
  viewMode: GanttViewMode,
  range: TimeRange,
): ScheduleGanttModel {
  // 週次・月次は行数を抑えるため、同じ工程のセグメントを1行に並べる（日次は1セグメント1行）
  const shareRows = viewMode === 'Week' || viewMode === 'Month'
  const tasks: GanttTask[] = []
  const labels = new Map<string, RowLabel>()
  const groupIds: string[] = []
  const append = (rows: { tasks: GanttTask[]; labels: Map<string, RowLabel> }) => {
    tasks.push(...rows.tasks)
    rows.labels.forEach((label, id) => labels.set(id, label))
  }

  if (groupBy === 'none') {
    append(
      buildProcessRows(schedules, {
        colorMode,
        groupBy,
        shareRows,
        range,
        compareRows: byStart,
        label: processWithOrderLabel,
      }),
    )
    return { tasks, labels, groupIds }
  }

  if (groupBy === 'order') {
    groupByKey(schedules, (s) => s.order_id).forEach((items) => {
      const head = items[0]
      const id = `group-order-${head.order_id}`
      // サマリーバーは注文の最初の工程の開始〜最後の工程の終了（表示期間外を含む。範囲外はグリッドの端で切れる）
      const visible = visibleExtent(items)
      const start = head.order_start_datetime ? new Date(head.order_start_datetime) : visible.start
      const end = head.order_end_datetime ? new Date(head.order_end_datetime) : visible.end
      const deadline = orderDeadline(head, end)
      tasks.push({
        id,
        name: scheduleOrderTitle(head),
        start,
        end,
        color: SUMMARY_BAR_COLOR,
        isGroupHeader: true,
        ...(deadline ? { markers: [deadline.marker] } : {}),
        ...(start < range.start ? { continuesBefore: true } : {}),
        ...(end > range.end ? { continuesAfter: true } : {}),
      })
      labels.set(id, {
        kind: 'order',
        orderId: head.order_id,
        deadlineExceeded: deadline?.exceeded ?? false,
        customer: scheduleCustomerLabel(head),
        isUnknownCustomer: !head.customer_name,
        product: head.product_name ?? null,
        quantity: scheduleQuantityLabel(head),
        meta: scheduleOrderMeta(head),
      })
      groupIds.push(id)
      append(
        buildProcessRows(items, {
          colorMode,
          groupBy,
          shareRows,
          range,
          parentId: id,
          compareRows: compareBySequence,
          label: processWithEquipmentLabel,
        }),
      )
    })
    return { tasks, labels, groupIds }
  }

  // 設備グループ別: 同じ表示名のグループがあり得るので id でまとめる
  groupByKey(schedules, (s) => s.equipment_group_id ?? null).forEach((items) => {
    const head = items[0]
    const id = `group-equip-${head.equipment_group_id ?? 'none'}`
    const title = head.equipment_group_name || '未分類'
    tasks.push({ id, name: title, ...visibleExtent(items), isGroupHeader: true })
    labels.set(id, { kind: 'group', title })
    groupIds.push(id)
    append(
      buildProcessRows(items, {
        colorMode,
        groupBy,
        shareRows: false,
        range,
        parentId: id,
        compareRows: byStart,
        label: processWithOrderLabel,
      }),
    )
  })
  return { tasks, labels, groupIds }
}

/** 工程の状態 → バーの外観 */
const STATE_APPEARANCE: Record<ProcessDisplayState, GanttBarAppearance> = {
  planned_only: 'neutral',
  not_started: 'subtle',
  in_progress: 'default',
  completed: 'muted',
  delayed: 'danger',
}

/**
 * バーに工程の状態（外観・バッジ・進捗率）を載せる。進捗は工程単位なので、工程が複数のセグメントに
 * 分かれる場合は各セグメントのバーに同じ状態を出す。進捗の行が無い工程は「計画のみ」（未着手と見せない）
 */
function applyProgress(
  tasks: GanttTask[],
  scheduleMap: Map<string, Schedule>,
  progressIndex: Map<string, ProcessProgress>,
  now: Date,
): GanttTask[] {
  return tasks.map((task) => {
    if (task.isGroupHeader) return task
    const schedule = scheduleMap.get(task.id)
    const progress = schedule
      ? progressIndex.get(progressKey(schedule.order_id, schedule.process_routing_id))
      : undefined
    const state = processDisplayState(progress, now)
    const badge = processStateBadge(state, progress)
    return {
      ...task,
      appearance: STATE_APPEARANCE[state],
      ...(badge ? { badge } : {}),
      ...(progress ? { progress: progressRatio(progress) ?? undefined } : {}),
    }
  })
}

/**
 * 工程の前倒し・後ろ倒しのプレビューを重ねる（Issue #582）。動く工程の元のバーは薄くし、ずらした後の
 * セグメントをゴーストバーとしてその工程の最初の行に重ねる。表示中に行が無い工程（表示期間の外）には
 * 重ねない（ゴーストバーだけの行を作らない）。1セグメント1行の表示（日次・設備グループ別）は行に rowId が
 * 無いので、元のバーの id を rowId にして同じ行へ並べる（行の識別子は変わらない）
 */
export function applyShiftPreview(
  tasks: GanttTask[],
  scheduleMap: Map<string, Schedule>,
  preview: ProcessShiftResult | null | undefined,
): GanttTask[] {
  if (!preview) return tasks
  const moved = new Map(preview.processes.map((p) => [p.process_routing_id, p]))
  const anchored = new Set<number>()
  const ghosts: GanttTask[] = []
  const result = tasks.map((task) => {
    const schedule = scheduleMap.get(task.id)
    const process =
      schedule && schedule.order_id === preview.order_id ? moved.get(schedule.process_routing_id) : undefined
    if (!process) return task
    const rowId = task.rowId ?? task.id
    if (!anchored.has(process.process_routing_id)) {
      anchored.add(process.process_routing_id)
      process.segments.forEach((seg, i) => {
        const start = new Date(seg.start_datetime)
        const end = new Date(seg.end_datetime)
        ghosts.push({
          id: `shift-preview-${process.process_routing_id}-${i}`,
          name: `${task.name}（変更後）`,
          start,
          end,
          color: task.color,
          isGhost: true,
          isMilestone: start.getTime() === end.getTime(),
          rowId,
          ...(task.parentId !== undefined ? { parentId: task.parentId } : {}),
        })
      })
    }
    return { ...task, rowId, dimmed: true }
  })
  return [...result, ...ghosts]
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

/** ラベル列の幅（px）。1180px 級のタブレット横向きでもタイムラインが残る幅 */
const LABEL_COLUMN_WIDTH = 260

/** 注文行の高さ（px）。ラベルは2行（通称／製品名・数量）に収める。タップ目標 44px 以上（Issue #581 / #589） */
const ORDER_ROW_HEIGHT = 48
/** 設備グループ行の高さ（px）。タップ目標 44px 以上（Issue #581） */
const EQUIPMENT_GROUP_ROW_HEIGHT = 48
/** 工程行の高さ・工程バーの高さ（px）。タブレットの指でも狙えるよう、行は 44px 以上にする（Issue #581） */
const PROCESS_ROW_HEIGHT = 52
const PROCESS_BAR_HEIGHT = 36

/**
 * 固定ラベル列の1行分（Issue #579）。どの行も2行以内に収め、長い名前は1行で省略する（全文は詳細シート）。
 * 状態・納期超過はアイコンのみで、意味は凡例と詳細シートで示す（Issue #589）
 */
function RowLabelContent({
  label,
  stateBadge,
}: {
  label: RowLabel | undefined
  stateBadge?: { state: StateBadgeState; text: string } | null
}) {
  if (!label) return null
  const stateIcon = stateBadge && <StateIcon state={stateBadge.state} label={stateBadge.text} />
  switch (label.kind) {
    case 'order':
      return (
        <div className="min-w-0 leading-tight">
          <div className="flex items-center gap-1">
            <p
              className={`min-w-0 flex-1 truncate font-semibold ${
                label.isUnknownCustomer ? 'text-gray-500 dark:text-gray-400' : 'text-gray-800 dark:text-gray-100'
              }`}
            >
              {label.customer}
            </p>
            {/* 2つ並ぶときは「納期超過 → 状態」の順で固定する */}
            {label.deadlineExceeded && <DeadlineExceededIcon />}
            {stateIcon}
          </div>
          {(label.product || label.quantity) && (
            // 製品名だけを省略し、数量は切らない
            <div className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-gray-700 dark:text-gray-300">
              {label.product && <span className="min-w-0 truncate">{label.product}</span>}
              {label.quantity && <span className="shrink-0 tabular-nums">{label.quantity}</span>}
            </div>
          )}
        </div>
      )
    case 'group':
      return (
        <p className="truncate font-semibold text-gray-800 dark:text-gray-100">{label.title}</p>
      )
    case 'process':
      return (
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-gray-800 dark:text-gray-200">{label.primary}</p>
            {label.secondary && (
              <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">{label.secondary}</p>
            )}
          </div>
          {stateIcon}
        </div>
      )
  }
}

const LABEL_HEADERS: Record<GroupByMode, string> = {
  order: '注文 / 工程',
  equipment_group: '設備グループ / 工程',
  none: '工程',
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
  selection,
  onSelect,
  collapsedGroupIds: controlledCollapsedGroupIds,
  onCollapsedGroupIdsChange,
  progress,
  shiftPreview,
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
  const progressByOrder = useMemo(() => {
    const map = new Map<number, ProcessProgress[]>()
    progress?.forEach((p) => map.set(p.order_id, [...(map.get(p.order_id) ?? []), p]))
    return map
  }, [progress])
  // 遅れの判定の「今」。進捗を取り直したときに更新する
  // eslint-disable-next-line react-hooks/exhaustive-deps -- progress は「今」を取り直す合図（値は使わない）
  const now = useMemo(() => new Date(), [progress])

  const model = useMemo(
    () =>
      buildScheduleGanttModel(tasks, groupBy, colorMode, viewMode, {
        start: rangeStart,
        end: rangeEnd,
      }),
    [tasks, groupBy, colorMode, viewMode, rangeStart, rangeEnd],
  )

  const ganttTasks = useMemo(
    () => applyShiftPreview(applyProgress(model.tasks, scheduleMap, progressIndex, now), scheduleMap, shiftPreview),
    [model, scheduleMap, progressIndex, now, shiftPreview],
  )

  // 折りたたみ中のグループ行（注文・設備グループ）の id。グルーピングを切り替えても id が衝突しないので持ち越す。
  // 画面が localStorage に覚えるときは props で制御する（Issue #581）
  const [internalCollapsedGroupIds, setInternalCollapsedGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const collapsedGroupIds = controlledCollapsedGroupIds ?? internalCollapsedGroupIds
  const setCollapsedGroupIds = (ids: ReadonlySet<string>) => {
    if (controlledCollapsedGroupIds === undefined) setInternalCollapsedGroupIds(ids)
    onCollapsedGroupIdsChange?.(ids)
  }
  const toggleGroup = (groupId: string) => {
    const next = new Set(collapsedGroupIds)
    if (next.has(groupId)) next.delete(groupId)
    else next.add(groupId)
    setCollapsedGroupIds(next)
  }

  // プレビューのゴーストバーは区間の数に数えない
  const rowSummaries = useMemo(() => summarizeRows(ganttTasks.filter((t) => !t.isGhost)), [ganttTasks])

  const progressOf = (task: GanttTask): ProcessProgress | undefined => {
    const schedule = scheduleMap.get(task.id)
    return schedule
      ? progressIndex.get(progressKey(schedule.order_id, schedule.process_routing_id))
      : undefined
  }

  /** ラベル列の状態バッジ: 工程行はその工程の状態、注文行は注文全体の状態 */
  const stateBadgeOf = (label: RowLabel | undefined, task: GanttTask) => {
    if (label?.kind === 'order') return orderStateLabelText(progressByOrder.get(label.orderId) ?? [], now)
    if (label?.kind !== 'process') return null
    const taskProgress = progressOf(task)
    const state = processDisplayState(taskProgress, now)
    const text = processStateLabelText(state, taskProgress)
    return text ? { state, text } : null
  }

  // 詳細シートで開いている行。工程は日次・設備グループ別だとセグメントごとの行になるので、その工程の行をすべて塗る。
  // 注文は注文行（オーダー別）、注文行の無い表示単位ではその注文の工程の行
  const selectedRowKeys = useMemo(() => {
    const keys = new Set<string>()
    if (!selection) return keys
    model.tasks.forEach((task) => {
      if (selection.kind === 'order' && task.id === `group-order-${selection.orderId}`) {
        keys.add(getRowKey(task))
        return
      }
      const schedule = scheduleMap.get(task.id)
      if (!schedule || schedule.order_id !== selection.orderId) return
      if (selection.kind === 'process' ? schedule.process_routing_id === selection.processRoutingId : groupBy !== 'order') {
        keys.add(getRowKey(task))
      }
    })
    return keys
  }, [selection, model, scheduleMap, groupBy])

  /** タスク（行の先頭・バー）→ 選ぶもの。設備グループの行は null */
  const selectionOf = (task: GanttTask): ScheduleSelection | null => {
    const label = model.labels.get(task.id)
    if (label?.kind === 'order') return { kind: 'order', orderId: label.orderId }
    const schedule = scheduleMap.get(task.id)
    return schedule
      ? { kind: 'process', orderId: schedule.order_id, processRoutingId: schedule.process_routing_id }
      : null
  }

  const handleTaskClick = onSelect
    ? (task: GanttTask) => {
        const next = selectionOf(task)
        if (next) onSelect(next)
      }
    : undefined

  const handleRowClick = (rowTasks: GanttTask[]) => {
    const head = rowTasks[0]
    const next = selectionOf(head)
    if (next) {
      onSelect?.(next)
      return
    }
    // 設備グループ行: ラベル全体を折りたたみの切り替えにする（小さいボタンを狙わなくてよい）
    if (head.isGroupHeader && model.groupIds.includes(head.id)) toggleGroup(head.id)
  }

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
      labelWidth={LABEL_COLUMN_WIDTH}
      rowHeight={PROCESS_ROW_HEIGHT}
      barHeight={PROCESS_BAR_HEIGHT}
      labelHeader={
        <div className="flex w-full items-center justify-between gap-1">
          <span>{LABEL_HEADERS[groupBy]}</span>
          {model.groupIds.length > 0 && (
            <div className="flex">
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label="すべて展開"
                title="すべて展開"
                onClick={() => setCollapsedGroupIds(new Set())}
              >
                <ChevronsUpDown className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11"
                aria-label="すべて折りたたむ"
                title="すべて折りたたむ"
                onClick={() => setCollapsedGroupIds(new Set(model.groupIds))}
              >
                <ChevronsDownUp className="h-5 w-5" />
              </Button>
            </div>
          )}
        </div>
      }
      groupRowHeight={groupBy === 'order' ? ORDER_ROW_HEIGHT : EQUIPMENT_GROUP_ROW_HEIGHT}
      renderRowLabel={(rowTasks) => {
        const label = model.labels.get(rowTasks[0].id)
        return <RowLabelContent label={label} stateBadge={stateBadgeOf(label, rowTasks[0])} />
      }}
      collapsedGroupIds={collapsedGroupIds}
      onToggleGroup={toggleGroup}
      workHours={workHoursForLib}
      nonWorkingDays={nonWorkingDaysForLib}
      onTaskClick={handleTaskClick}
      onRowClick={onSelect ? handleRowClick : undefined}
      selectedRowKeys={selectedRowKeys}
      wrapTaskBar={(task: GanttTask, children) => {
        const taskProgress = task.isGroupHeader ? undefined : progressOf(task)
        const label = model.labels.get(task.id)
        return (
          <Tooltip>
            <TooltipTrigger asChild>{children}</TooltipTrigger>
            <TooltipContent>
              <p className="font-semibold">{task.name}</p>
              {label?.kind === 'order' && <p>{label.meta.join(' ・ ')}</p>}
              <p>{task.isMilestone ? formatDateTime(task.start) : formatRange(task.start, task.end)}</p>
              {!task.isGroupHeader && <RowSegmentsTooltipLine summary={rowSummaries.get(task.id)} />}
              {taskProgress && (
                <ProgressTooltipLines progress={taskProgress} delayed={task.appearance === 'danger'} />
              )}
            </TooltipContent>
          </Tooltip>
        )
      }}
    />
  )
}
