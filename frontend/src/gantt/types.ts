import type { ReactNode } from 'react'

/**
 * バーの見た目
 * - default: color の塗り
 * - neutral: 無彩色の塗り（color を使わない）
 * - subtle: 淡い塗り＋color の枠線（まだ始まっていない）
 * - muted: くすんだ色（目立たせない）
 * - danger: 赤の斜線入りの塗り（最も目立たせる）
 */
export type GanttBarAppearance = 'default' | 'neutral' | 'subtle' | 'muted' | 'danger'

/** 行に重ねる縦線の目印 */
export interface GanttMarker {
  at: Date
  /** 線の脇に出す文言。表示範囲の外なら端に `→ label` / `← label` として出す */
  label: string
  /** 'danger' は赤で描く */
  tone?: 'default' | 'danger'
}

/**
 * 汎用ガントチャートのタスク型
 * プロダクト固有のドメイン知識を持たない
 */
export interface GanttTask {
  /** ユニークなID */
  id: string
  /** タスク名（ラベル列の既定表示・ツールチップ等に使う。バー自体には描かない） */
  name: string
  /** タスク開始時刻 */
  start: Date
  /** タスク終了時刻 */
  end: Date
  /** バーの背景色（CSS color string） */
  color?: string
  /** ツールチップとして表示するReactNode（外部から注入可能） */
  tooltip?: ReactNode
  /**
   * グループヘッダー行として表示する場合 true。バーは期間を示す細いサマリーバー（ブラケット形）で描き、
   * 通常のバーと太さで区別する
   */
  isGroupHeader?: boolean
  /**
   * 属するグループヘッダーのタスクの id。指定すると子行としてラベルをインデントし、
   * グループを折りたたんだときに隠す
   */
  parentId?: string
  /** 表示範囲より前から続いている場合 true（バーの始端に「続き」の印を出す） */
  continuesBefore?: boolean
  /** 表示範囲より後へ続いている場合 true（バーの終端に「続き」の印を出す） */
  continuesAfter?: boolean
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
  /**
   * バーの見た目。未指定は 'default'（color の塗り＋progress の塗り）。
   * グループヘッダーでは無視する
   */
  appearance?: GanttBarAppearance
  /** バーの中に出す短いテキスト・記号（例: `60%`、`✓`）。マイルストーン・グループヘッダーでは出さない */
  badge?: string
  /**
   * 行のタイムライン上に縦線で示す目印（納期など）。同じ rowId の行は先頭タスクのものを使う
   */
  markers?: GanttMarker[]
  /**
   * 同じ行に並べるタスクの識別子。同じ rowId のタスクは1行にまとめて描画する
   * （1つの作業が飛び飛びの区間に分かれる場合に、区間ごとのバーを1行に並べる）。
   * 未指定ならタスクごとに1行
   */
  rowId?: string
}

/**
 * ガントチャートの表示モード
 */
export type GanttViewMode = 'Day' | 'Week' | 'Month'
