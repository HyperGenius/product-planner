import type { ReactNode } from 'react'

/**
 * 汎用ガントチャートのタスク型
 * プロダクト固有のドメイン知識を持たない
 */
export interface GanttTask {
  /** ユニークなID */
  id: string
  /** バー上に表示するラベル */
  name: string
  /** タスク開始時刻 */
  start: Date
  /** タスク終了時刻 */
  end: Date
  /** バーの背景色（CSS color string） */
  color?: string
  /** ツールチップとして表示するReactNode（外部から注入可能） */
  tooltip?: ReactNode
  /** グループヘッダー行として表示する場合 true */
  isGroupHeader?: boolean
  /**
   * 所要時間 0（start と end が同一時刻）のマイルストーン工程として
   * 幅0のバーではなくひし形マーカーで描画する場合 true
   */
  isMilestone?: boolean
}

/**
 * ガントチャートの表示モード
 */
export type GanttViewMode = 'Day' | 'Week' | 'Month'
