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
  /**
   * 進捗率（0〜1）。指定するとバーの左からこの割合を塗る。未指定なら塗らない。
   * グループヘッダー・マイルストーンでは無視する
   */
  progress?: number
  /** 遅れとして強調表示する場合 true（グループヘッダーでは無視する） */
  isDelayed?: boolean
  /**
   * 同じ行に並べるタスクの識別子。同じ rowId のタスクは1行にまとめて描画する
   * （1つの作業が飛び飛びの区間に分かれる場合に、区間ごとのバーを1行に並べる）。
   * 未指定ならタスクごとに1行
   */
  rowId?: string
  /** バー横のラベルを出さない場合 true（同じ行の2本目以降のバー等） */
  hideLabel?: boolean
}

/**
 * ガントチャートの表示モード
 */
export type GanttViewMode = 'Day' | 'Week' | 'Month'
