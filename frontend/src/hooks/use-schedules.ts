"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { ApiError, apiClient } from "@/lib/api-client"
import { DAILY_REPORT_PROGRESS_QUERY_KEY } from "@/hooks/use-daily-report-progress"
import type { Schedule } from "@/types/schedule"
import type { ProcessShiftResult, ProcessShiftTarget } from "@/types/schedule-shift"
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
 *
 * @param options.refetchInterval 自動再取得の間隔(ms)。現場ダッシュボード（Issue #443）等、
 *   常時表示前提の画面から指定する想定。未指定時は自動再取得しない（`use-orders.ts` と同じ方針）
 */
export function useSchedules(params: ScheduleQueryParams, options?: { refetchInterval?: number }) {
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
    refetchInterval: options?.refetchInterval,
  })
}

/**
 * スケジュールを更新するフック（ガントの詳細シートの「操作」から開始・終了を変更する。Issue #581）。
 * 変更できるのは `SCHEDULE_EDITOR_ROLES` のロールだけ（それ以外は 403）
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
      toast.error("スケジュールを更新できませんでした")
    },
  })
}

function postProcessShift(target: ProcessShiftTarget, dryRun: boolean) {
  return apiClient<ProcessShiftResult>(
    `/orders/${target.orderId}/processes/${target.processRoutingId}/shift`,
    {
      method: "POST",
      body: JSON.stringify({ working_days: target.workingDays, dry_run: dryRun }),
    },
  )
}

/** 工程のずらしの失敗の文言。409 の detail は外部入力なので、既知のコードだけ固定文言に寄せる */
export function processShiftErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "計画をずらす権限がありません"
    if (error.errorCode === "schedule_changed") return "計画が他の操作で変わりました。もう一度プレビューしてください"
    if (error.errorCode === "order_not_adjustable") return "確定済み・生産中の注文だけ計画をずらせます"
    if (error.status === 404) return "この工程の計画が見つかりません"
  }
  return "計画をずらせませんでした"
}

/**
 * 工程の前倒し・後ろ倒しのプレビュー（`dry_run`。Issue #582）。ボタンを押すたびに呼ぶ。
 * 続けて呼んだときは最後の呼び出しの結果だけが `data` に入る
 */
export function useProcessShiftPreview() {
  return useMutation({
    mutationFn: (target: ProcessShiftTarget) => postProcessShift(target, true),
  })
}

/**
 * 工程をずらした計画を保存する（Issue #582）。スケジュール・完成見込み（受注）・遅れの基準（進捗の
 * `planned_end_datetime` はスケジュールから都度求める）が変わるので、それぞれのクエリを無効化する
 */
export function useShiftProcess() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (target: ProcessShiftTarget) => postProcessShift(target, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
      queryClient.invalidateQueries({ queryKey: ["orders"] })
      queryClient.invalidateQueries({ queryKey: DAILY_REPORT_PROGRESS_QUERY_KEY })
      toast.success("計画をずらしました")
    },
    onError: (error) => {
      toast.error(processShiftErrorMessage(error))
    },
  })
}
