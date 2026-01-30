// frontend/src/types/calendar.ts

/**
 * カレンダー情報
 */
export interface Calendar {
  id?: number
  tenant_id?: string
  date: string
  is_holiday: boolean
  note?: string | null
}

/**
 * カレンダー作成用
 */
export interface CalendarCreate {
  date: string
  is_holiday: boolean
  note?: string | null
}

/**
 * カレンダー更新用
 */
export interface CalendarUpdate {
  is_holiday?: boolean
  note?: string | null
}

/**
 * 一括更新リクエスト
 */
export interface BatchUpdateRequest {
  dates: string[]
  is_holiday: boolean
  note?: string | null
}

/**
 * 一括更新レスポンス
 */
export interface BatchUpdateResponse {
  updated_count: number
  total_count: number
}
