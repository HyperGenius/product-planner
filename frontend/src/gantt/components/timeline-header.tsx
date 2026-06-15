import { useMemo } from 'react'
import { format, addHours, addDays, startOfDay } from 'date-fns'
import { ja } from 'date-fns/locale'
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
  const { rangeStart, totalUnits, columnWidthPx, slotTimestamps } = config

  const gridTemplateColumns = columnWidthPx
    ? `repeat(${totalUnits}, ${columnWidthPx}px)`
    : `repeat(${totalUnits}, minmax(0, 1fr))`

  const cells = useMemo(() => {
    // 週次モード + 稼働時間グリッド: 稼働日1日1セル（時刻行なし）
    if (viewMode === 'Week' && slotTimestamps && slotTimestamps.length > 0) {
      // スロットを日付でグループ化してスパンを計算
      const dayGroups: { dayKey: string; date: Date; colStart: number; span: number }[] = []
      let currentDayKey = ''
      let colStart = 1

      slotTimestamps.forEach((slot, idx) => {
        const dayKey = format(startOfDay(slot), 'yyyy-MM-dd')
        if (dayKey !== currentDayKey) {
          if (currentDayKey !== '') {
            dayGroups[dayGroups.length - 1].span = idx - dayGroups[dayGroups.length - 1].colStart + 1
          }
          currentDayKey = dayKey
          colStart = idx + 1
          dayGroups.push({ dayKey, date: slot, colStart, span: 1 })
        }
      })
      // 最後のグループのスパンを確定
      if (dayGroups.length > 0) {
        const last = dayGroups[dayGroups.length - 1]
        last.span = slotTimestamps.length - last.colStart + 1
      }

      const dayLabels = dayGroups.map(({ date, colStart, span }) => ({
        label: format(date, 'M/d (EEE)', { locale: ja }),
        colStart,
        colEnd: colStart + span,
      }))

      return { dayLabels, hourLabels: [], showHours: false }
    }

    if (viewMode === 'Day') {
      // 3日分の日付ラベル（各24列スパン）
      const dayLabels = [0, 1, 2].map((i) => ({
        label: format(addDays(rangeStart, i), 'MM/dd (EEE)'),
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

    // Month モード: 日付ラベルのみ（1日もしくは最終日のみMM/dd、それ以外はd）
    const dayLabels = Array.from({ length: totalUnits }, (_, i) => ({
      label: i === 0 || i === totalUnits - 1
        ? format(addDays(rangeStart, i), 'MM/dd')
        : format(addDays(rangeStart, i), 'd'),
      colStart: i + 1,
      colEnd: i + 2,
    }))
    return { dayLabels, hourLabels: [], showHours: false }
  }, [viewMode, rangeStart, totalUnits, slotTimestamps])

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

      {/* 時刻行（Month モードおよび稼働時間グリッドの週次モードは非表示） */}
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
