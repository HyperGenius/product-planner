import type { GanttViewMode } from '../types'

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
}

/**
 * 表示範囲と表示モードからタイムライン設定を構築する
 */
export function buildTimelineConfig(
  rangeStart: Date,
  rangeEnd: Date,
  viewMode: GanttViewMode,
): TimelineConfig {
  if (viewMode === 'Month') {
    const unitDurationMs = 24 * 60 * 60 * 1000 // 1日
    const totalMs = rangeEnd.getTime() - rangeStart.getTime()
    return {
      rangeStart,
      rangeEnd,
      totalUnits: Math.ceil(totalMs / unitDurationMs),
      unitDurationMs,
      // columnWidthPx 未指定 → 1fr で画面幅に収まる
    }
  }

  // Day・Week モード: 1時間単位
  const unitDurationMs = 60 * 60 * 1000 // 1時間
  const totalMs = rangeEnd.getTime() - rangeStart.getTime()
  const totalUnits = Math.ceil(totalMs / unitDurationMs)
  return {
    rangeStart,
    rangeEnd,
    totalUnits,
    unitDurationMs,
    columnWidthPx: viewMode === 'Day' ? 60 : undefined, // Day: 固定幅, Week: 1fr
  }
}

/**
 * タスクの開始・終了時刻からグリッド列位置（1始まり）を計算する
 */
export function getTaskGridColumns(
  taskStart: Date,
  taskEnd: Date,
  config: TimelineConfig,
): { colStart: number; colEnd: number } {
  const { rangeStart, unitDurationMs, totalUnits } = config
  const rangeStartMs = rangeStart.getTime()

  const rawColStart = Math.floor((taskStart.getTime() - rangeStartMs) / unitDurationMs) + 1
  const rawColEnd = Math.ceil((taskEnd.getTime() - rangeStartMs) / unitDurationMs) + 1

  const colStart = Math.max(1, Math.min(rawColStart, totalUnits))
  const colEnd = Math.max(colStart + 1, Math.min(rawColEnd, totalUnits + 1))

  return { colStart, colEnd }
}

/**
 * 現在時刻のグリッド上の小数列位置を返す（表示範囲外なら null）
 */
export function getNowFractionalColumn(config: TimelineConfig): number | null {
  const now = Date.now()
  const { rangeStart, rangeEnd, unitDurationMs } = config

  if (now < rangeStart.getTime() || now > rangeEnd.getTime()) return null

  return (now - rangeStart.getTime()) / unitDurationMs + 1
}
