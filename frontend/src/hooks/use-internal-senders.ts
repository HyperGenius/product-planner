"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { InternalSender, InternalSenderCreate } from "@/types/internal-sender"

const INTERNAL_SENDERS_QUERY_KEY = ["internal-senders"]

/**
 * 社内転送者の一覧を取得するフック（president / platform_admin のみ。Issue #521）
 */
export function useInternalSenders() {
  return useQuery<InternalSender[]>({
    queryKey: INTERNAL_SENDERS_QUERY_KEY,
    queryFn: () => apiClient<InternalSender[]>("/tenant/internal-senders"),
  })
}

/**
 * 社内転送者を登録するフック
 */
export function useCreateInternalSender() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: InternalSenderCreate) =>
      apiClient<InternalSender>("/tenant/internal-senders", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTERNAL_SENDERS_QUERY_KEY })
    },
  })
}

/**
 * 社内転送者の登録を解除するフック
 */
export function useDeleteInternalSender() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/tenant/internal-senders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTERNAL_SENDERS_QUERY_KEY })
    },
  })
}
