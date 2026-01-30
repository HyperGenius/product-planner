"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { Schedule } from "@/types/schedule"
import { toast } from "sonner"

/**
 * スケジュール取得のクエリパラメータ
 */
export interface ScheduleQueryParams {
  start_date: string // ISO 8601 形式 (YYYY-MM-DD)
  end_date: string // ISO 8601 形式 (YYYY-MM-DD)
  equipment_group_id?: number // 設備グループでのフィルタ
}

/**
 * スケジュール更新のリクエストボディ
 */
export interface ScheduleUpdateParams {
  start_datetime?: string // ISO 8601 形式
  end_datetime?: string // ISO 8601 形式
  equipment_id?: number
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

/**
 * スケジュールを更新するフック (ガントチャートのドラッグ&ドロップ用)
 */
export function useUpdateSchedule() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ 
      scheduleId, 
      data 
    }: { 
      scheduleId: number
      data: ScheduleUpdateParams 
    }) => {
      return apiClient<Schedule>(`/production-schedules/${scheduleId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    },
    onSuccess: () => {
      // スケジュール一覧をすべて無効化して再取得
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
      // 成功メッセージを表示
      toast.success("スケジュールを更新しました")
    },
    onError: (error) => {
      console.error("Failed to update schedule:", error)
    },
  })
}
