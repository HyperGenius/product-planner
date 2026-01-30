"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type {
  Calendar,
  CalendarCreate,
  BatchUpdateRequest,
  BatchUpdateResponse,
} from "@/types/calendar"

// クエリキーを動的に生成
const getCalendarsQueryKey = (year: number, month: number) => [
  "calendars",
  year,
  month,
]

/**
 * 指定月のカレンダー情報を取得するフック
 */
export function useCalendars(year: number, month: number) {
  return useQuery<Calendar[]>({
    queryKey: getCalendarsQueryKey(year, month),
    queryFn: () => apiClient<Calendar[]>(`/calendars?year=${year}&month=${month}`),
  })
}

/**
 * カレンダー情報を作成/更新するフック
 */
export function useUpsertCalendar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CalendarCreate) =>
      apiClient<Calendar>("/calendars", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 全てのカレンダークエリを無効化して再取得
      queryClient.invalidateQueries({ queryKey: ["calendars"] })
    },
  })
}

/**
 * カレンダー情報を一括更新するフック
 */
export function useBatchUpdateCalendars() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: BatchUpdateRequest) =>
      apiClient<BatchUpdateResponse>("/calendars/batch", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 全てのカレンダークエリを無効化して再取得
      queryClient.invalidateQueries({ queryKey: ["calendars"] })
    },
  })
}
