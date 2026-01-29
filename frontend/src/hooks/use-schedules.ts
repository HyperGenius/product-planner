"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { Schedule } from "@/types/schedule"

/**
 * スケジュール取得のクエリパラメータ
 */
export interface ScheduleQueryParams {
  start_date: string // ISO 8601 形式 (YYYY-MM-DD)
  end_date: string // ISO 8601 形式 (YYYY-MM-DD)
  equipment_group_id?: number // 設備グループでのフィルタ
}

/**
 * 生産スケジュール一覧を取得するフック
 */
export function useSchedules(params: ScheduleQueryParams) {
  return useQuery<Schedule[]>({
    queryKey: ["schedules", params.start_date, params.end_date, params.equipment_group_id],
    queryFn: async () => {
      const searchParams = new URLSearchParams({
        start_date: params.start_date,
        end_date: params.end_date,
      })
      
      if (params.equipment_group_id !== undefined) {
        searchParams.append("equipment_group_id", String(params.equipment_group_id))
      }
      
      return apiClient<Schedule[]>(`/production-schedules?${searchParams.toString()}`)
    },
    staleTime: 5 * 60 * 1000, // 5分
    refetchOnWindowFocus: false,
  })
}
