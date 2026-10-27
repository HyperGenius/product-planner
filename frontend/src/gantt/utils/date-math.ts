import { startOfDay } from 'date-fns'
import type { GanttViewMode } from '../types'

/**
 * 稼働時間設定
 */
export interface WorkHoursConfig {
  start: number
  end: number
  breakStart?: number
  breakEnd?: number
}

/**
 * タイムライン描画に必要な設定値
 */
export interface TimelineConfig {
  /** 表示開始時刻 */
  rangeStart: Date
  /** 表示終了時刻 */
  rangeEnd: Date
  /** 総グリッド列数 */
  totalUnits: number
  /** 1グリッド列あたりのミリ秒 */
  unitDurationMs: number
  /** 1グリッド列あたりの固定ピクセル幅（未指定の場合は 1fr で画面幅に収まる） */
  columnWidthPx?: number
  /**
   * 週次モード + 稼働時間設定がある場合のみ存在する。
   * 各稼働時間スロットの開始 Date の配列（長さ = totalUnits）。
   * このフィールドがある場合は unitDurationMs ではなくこの配列でグリッド列を計算する。
   */
  slotTimestamps?: Date[]
}

/**
 * 表示範囲と表示モードからタイムライン設定を構築する
 */
export function buildTimelineConfig(
  rangeStart: Date,
  rangeEnd: Date,
  viewMode: GanttViewMode,
  workHours?: WorkHoursConfig,
  nonWorkingDays?: Date[],
): TimelineConfig {
  if (viewMode === 'Month') {
    const unitDurationMs = 24 * 60 * 60 * 1000 // 1日
    const totalMs = rangeEnd.getTime() - rangeStart.getTime()
    return {
      rangeStart,
      rangeEnd,
      totalUnits: Math.ceil(totalMs / unitDurationMs),
      unitDurationMs,
    }
  }

  // Week モード + 稼働時間設定あり → 稼働スロットのみのグリッドを構築
  if (viewMode === 'Week' && workHours && nonWorkingDays) {
    const slotTimestamps = buildWorkingSlots(rangeStart, rangeEnd, workHours, nonWorkingDays)
    return {
      rangeStart,
      rangeEnd,
      totalUnits: slotTimestamps.length,
      unitDurationMs: 60 * 60 * 1000,
      slotTimestamps,
    }
  }

  // Day・Week モード（通常): 1時間単位
  const unitDurationMs = 60 * 60 * 1000 // 1時間
  const totalMs = rangeEnd.getTime() - rangeStart.getTime()
  const totalUnits = Math.ceil(totalMs / unitDurationMs)
  return {
    rangeStart,
    rangeEnd,
    totalUnits,
    unitDurationMs,
    columnWidthPx: viewMode === 'Day' ? 60 : undefined,
  }
}

/**
 * 稼働時間スロットの Date 配列を構築する（週次モード用）
 */
function buildWorkingSlots(
  rangeStart: Date,
  rangeEnd: Date,
  workHours: WorkHoursConfig,
  nonWorkingDays: Date[],
): Date[] {
  const nonWorkingSet = new Set(
    nonWorkingDays.map((d) => startOfDay(d).getTime()),
  )

  const slots: Date[] = []
  const { start, end, breakStart, breakEnd } = workHours

  const current = new Date(rangeStart)
  current.setHours(0, 0, 0, 0)
  const rangeEndTime = rangeEnd.getTime()

  while (current.getTime() < rangeEndTime) {
    const dayKey = startOfDay(current).getTime()
    if (!nonWorkingSet.has(dayKey)) {
      for (let h = start; h < end; h++) {
        if (breakStart !== undefined && breakEnd !== undefined && h >= breakStart && h < breakEnd) {
          continue
        }
        const slot = new Date(current)
        slot.setHours(h, 0, 0, 0)
        slots.push(slot)
      }
    }
    current.setDate(current.getDate() + 1)
  }

  return slots
}

/**
 * タスクの開始・終了時刻からグリッド列位置（1始まり）を計算する
 */
export function getTaskGridColumns(
  taskStart: Date,
  taskEnd: Date,
  config: TimelineConfig,
): { colStart: number; colEnd: number } {
  const { slotTimestamps } = config

  if (slotTimestamps && slotTimestamps.length > 0) {
    return getTaskGridColumnsFromSlots(taskStart, taskEnd, slotTimestamps)
  }

  const { rangeStart, unitDurationMs, totalUnits } = config
  const rangeStartMs = rangeStart.getTime()

  // 開始は「開始時刻を含む列」（切り捨て）。切り上げると月次（1列＝1日）で 09:00 開始が翌日の列になる（Issue #537）。
  // 終了は排他の線なので切り上げのまま
  const rawColStart = Math.floor((taskStart.getTime() - rangeStartMs) / unitDurationMs) + 1
  const rawColEnd = Math.ceil((taskEnd.getTime() - rangeStartMs) / unitDurationMs) + 1

  const colStart = Math.max(1, Math.min(rawColStart, totalUnits))
  const colEnd = Math.max(colStart + 1, Math.min(rawColEnd, totalUnits + 1))

  return { colStart, colEnd }
}

/**
 * マイルストーン工程（所要時間 0）のマーカーを描画するグリッド列位置（1始まり）を返す。
 *
 * 通常バーの `getTaskGridColumns()` は `colEnd = Math.max(colStart + 1, ...)` で
 * 最小 1 列幅を保証するため、start == end のタスクも「幅 1 列のバー」になってしまい
 * マイルストーンとして視認できない。この関数は開始列だけを算出し、呼び出し側で
 * 幅を持たない◇マーカーとして描画するために使う。
 *
 * 開始列の丸めは `getTaskGridColumns()` の colStart（切り捨て＝開始時刻を含む列）に揃える。
 * 稼働時間スロット側（`binarySearchFirstGe` = 開始以降の最初のスロット）と揃える。
 */
export function getMilestoneGridColumn(
  taskStart: Date,
  config: TimelineConfig,
): number {
  const { slotTimestamps } = config

  if (slotTimestamps && slotTimestamps.length > 0) {
    const total = slotTimestamps.length
    let idx = binarySearchFirstGe(slotTimestamps, taskStart.getTime())
    if (idx >= total) idx = total - 1
    if (idx < 0) idx = 0
    return idx + 1
  }

  const { rangeStart, unitDurationMs, totalUnits } = config
  const rawCol =
    Math.floor((taskStart.getTime() - rangeStart.getTime()) / unitDurationMs) + 1
  return Math.max(1, Math.min(rawCol, totalUnits))
}

/**
 * slotTimestamps を使ってグリッド列位置を計算する（稼働時間グリッド用）
 */
function getTaskGridColumnsFromSlots(
  taskStart: Date,
  taskEnd: Date,
  slots: Date[],
): { colStart: number; colEnd: number } {
  const taskStartMs = taskStart.getTime()
  const taskEndMs = taskEnd.getTime()
  const total = slots.length

  let colStartIdx = binarySearchFirstGe(slots, taskStartMs)
  if (colStartIdx >= total) colStartIdx = total - 1
  if (colStartIdx < 0) colStartIdx = 0

  // 終了時刻は排他なので、終了時刻以降の最初のスロットの手前までを塗る
  // （終了時刻ちょうどに始まるスロットを含めると、10:00 終了のタスクが 10:00 の列まで1列長くなる）
  let colEndIdx = binarySearchFirstGe(slots, taskEndMs)
  if (colEndIdx > total) colEndIdx = total
  if (colEndIdx <= colStartIdx) colEndIdx = colStartIdx + 1

  return {
    colStart: colStartIdx + 1,
    colEnd: colEndIdx + 1,
  }
}

/**
 * slots[i].getTime() >= targetMs を満たす最初のインデックスを返す（二分探索）
 */
function binarySearchFirstGe(slots: Date[], targetMs: number): number {
  let lo = 0
  let hi = slots.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (slots[mid].getTime() < targetMs) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/**
 * 現在時刻のグリッド上の小数列位置を返す（表示範囲外なら null）
 */
export function getNowFractionalColumn(config: TimelineConfig): number | null {
  return getFractionalColumn(config, new Date())
}

/**
 * 任意の時刻を、グリッド線の位置（1 始まりの列番号。小数あり）に変換する。
 * 表示範囲の外なら null。非稼働時間を除いたグリッドでは、その時刻以降で最初のスロットの左端に寄せる
 */
export function getFractionalColumn(config: TimelineConfig, at: Date): number | null {
  const time = at.getTime()
  const { rangeStart, rangeEnd, unitDurationMs, slotTimestamps } = config

  if (time < rangeStart.getTime() || time > rangeEnd.getTime()) return null

  if (slotTimestamps && slotTimestamps.length > 0) {
    const idx = binarySearchFirstGe(slotTimestamps, time)
    return idx + 1
  }

  return (time - rangeStart.getTime()) / unitDurationMs + 1
}
