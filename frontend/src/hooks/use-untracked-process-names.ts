"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { UntrackedProcessName } from "@/types/process-routing"

/**
 * 日報で追わない工程（Issue #681）。件数は工程名の数なので少なく、1リクエストで全件を引いて
 * 工程ルートの画面・受注詳細・ガントの詳細シートで共有する。
 *
 * 設定を変えても、日報の進捗は次の割り付けの再計算（定期実行）まで変わらないので、
 * 進捗のクエリは無効化しない
 */
export const UNTRACKED_PROCESS_NAMES_QUERY_KEY = ["untracked-process-names"]

const STALE_TIME_MS = 5 * 60 * 1000

export function useUntrackedProcessNames() {
  return useQuery<UntrackedProcessName[]>({
    queryKey: UNTRACKED_PROCESS_NAMES_QUERY_KEY,
    queryFn: () => apiClient<UntrackedProcessName[]>("/untracked-process-names"),
    staleTime: STALE_TIME_MS,
  })
}

/** 工程名を日報で追わない工程にする */
export function useAddUntrackedProcessName() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (processName: string) =>
      apiClient<UntrackedProcessName>("/untracked-process-names", {
        method: "POST",
        body: JSON.stringify({ process_name: processName }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: UNTRACKED_PROCESS_NAMES_QUERY_KEY }),
  })
}

/** 日報で追わない工程の設定を外す */
export function useRemoveUntrackedProcessName() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiClient<void>(`/untracked-process-names/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: UNTRACKED_PROCESS_NAMES_QUERY_KEY }),
  })
}
