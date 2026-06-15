/**
 * src/gantt - 汎用ガントチャートパッケージ
 *
 * このパッケージはプロダクト固有のコード（src/components/, src/lib/, src/hooks/ 等）に
 * 依存しない独立したUIライブラリとして設計されています。
 * 将来的なNPMパッケージ化を見据えたクリーンなアーキテクチャ境界を維持してください。
 */

export { GanttChart } from './components/gantt-chart'
export type { GanttChartProps } from './components/gantt-chart'
export type { GanttTask, GanttViewMode } from './types'
export { buildTimelineConfig, getTaskGridColumns, getNowFractionalColumn } from './utils/date-math'
export type { TimelineConfig, WorkHoursConfig } from './utils/date-math'
