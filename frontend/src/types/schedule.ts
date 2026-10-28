import type { Order } from '@/types/order'

/**
 * スケジュールのデータ型（バックエンドAPIレスポンス）
 */
export interface Schedule {
  id: number
  order_id: number
  process_routing_id: number
  equipment_id: number | null
  start_datetime: string // ISO 8601形式
  end_datetime: string // ISO 8601形式
  order_number?: string | null
  /** 顧客の注文番号 */
  customer_order_no?: string | null
  order_status?: Order['status'] | null
  quantity?: number | null
  /** 希望納期（日付のみ YYYY-MM-DD。parseISO でパースする） */
  desired_deadline?: string | null
  /** 完成見込み（承認確定時に算出。日付のみ YYYY-MM-DD） */
  confirmed_deadline?: string | null
  product_name?: string | null
  /** 顧客名。顧客不明（customer_id が NULL、#521）は null */
  customer_name?: string | null
  /** 顧客の通称（`customers.alias`）。ガントのラベルは通称を優先する（Issue #589） */
  customer_alias?: string | null
  process_name?: string | null
  /** 工程順（工程ルーティングの sequence_order） */
  sequence_order?: number | null
  equipment_name?: string | null
  equipment_group_id?: number | null
  /** 設備グループの表示名。1台グループはメンバーの設備の表示名（#512） */
  equipment_group_name?: string | null
  /** この工程の全セグメントの開始の最小〜終了の最大（表示期間外を含む。Issue #579） */
  process_start_datetime?: string | null
  process_end_datetime?: string | null
  /** この受注の全工程の開始の最小〜終了の最大（表示期間外を含む。Issue #579） */
  order_start_datetime?: string | null
  order_end_datetime?: string | null
}

/**
 * ガントチャートの表示モード
 */
export type GanttViewMode = 'Day' | 'Week' | 'Month'

/**
 * ガントチャートのグルーピングモード
 */
export type GroupByMode = 'none' | 'order' | 'equipment_group'
