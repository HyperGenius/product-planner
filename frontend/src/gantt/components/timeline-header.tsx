import { useMemo } from 'react'
import { format, addHours, addDays } from 'date-fns'
import type { GanttViewMode } from '../types'
import type { TimelineConfig } from '../utils/date-math'

interface TimelineHeaderProps {
  config: TimelineConfig
  viewMode: GanttViewMode
}

/**
 * タイムラインのヘッダーコンポーネント
 * 表示モードに応じて日付・時刻の目盛りを描画する
 */
export function TimelineHeader({ config, viewMode }: TimelineHeaderProps) {
  const { rangeStart, totalUnits, columnWidthPx } = config

  const gridTemplateColumns = columnWidthPx
    ? `repeat(${totalUnits}, ${columnWidthPx}px)`
    : `repeat(${totalUnits}, minmax(0, 1fr))`

  const cells = useMemo(() => {
    if (viewMode === 'Day') {
      // 3日分の日付ラベル（各24列スパン）
      const dayLabels = [0, 1, 2].map((i) => ({
        label: format(addDays(rangeStart, i), 'M/d (EEE)'),
        colStart: i * 24 + 1,
        colEnd: (i + 1) * 24 + 1,
      }))
      // 3時間ごとの時刻ラベル
      const hourLabels = Array.from({ length: 24 }, (_, i) => i * 3).map((h) => ({
        label: format(addHours(rangeStart, h), 'HH:mm'),
        colStart: h + 1,
        span: 3,
      }))
      return { dayLabels, hourLabels, showHours: true }
    }

    if (viewMode === 'Week') {
      // 7日分の日付ラベル（各24列スパン）
      const dayLabels = Array.from({ length: 7 }, (_, i) => ({
        label: format(addDays(rangeStart, i), 'M/d (EEE)'),
        colStart: i * 24 + 1,
        colEnd: (i + 1) * 24 + 1,
      }))
      // 6時間ごとの時刻ラベル
      const hourLabels = Array.from({ length: Math.ceil(totalUnits / 6) }, (_, i) => i * 6).map(
        (h) => ({
          label: format(addHours(rangeStart, h), 'HH'),
          colStart: h + 1,
          span: 6,
        }),
      )
      return { dayLabels, hourLabels, showHours: true }
    }

    // Month モード: 日付ラベルのみ
    const dayLabels = Array.from({ length: totalUnits }, (_, i) => ({
      label: format(addDays(rangeStart, i), 'd'),
      colStart: i + 1,
      colEnd: i + 2,
    }))
    return { dayLabels, hourLabels: [], showHours: false }
  }, [viewMode, rangeStart, totalUnits])

  return (
    <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 select-none">
      {/* 日付行 */}
      <div
        style={{ display: 'grid', gridTemplateColumns }}
        className="border-b border-gray-200 dark:border-gray-700"
      >
        {cells.dayLabels.map(({ label, colStart, colEnd }) => (
          <div
            key={colStart}
            style={{ gridColumn: `${colStart} / ${colEnd}` }}
            className="text-center text-xs font-semibold py-1 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 truncate px-1"
          >
            {label}
          </div>
        ))}
      </div>

      {/* 時刻行（Month モードは非表示） */}
      {cells.showHours && (
        <div style={{ display: 'grid', gridTemplateColumns }}>
          {cells.hourLabels.map(({ label, colStart, span }) => (
            <div
              key={colStart}
              style={{ gridColumn: `${colStart} / ${colStart + span}` }}
              className="text-center text-xs text-gray-400 dark:text-gray-500 py-0.5 border-r border-gray-100 dark:border-gray-700 overflow-hidden"
            >
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
