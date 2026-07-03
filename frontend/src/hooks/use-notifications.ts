"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { Notification } from "@/types/notification"

const NOTIFICATIONS_KEY = ["notifications"]

export function useNotifications() {
  return useQuery<Notification[]>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiClient<Notification[]>("/notifications"),
    refetchInterval: 1000 * 30,
  })
}

export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiClient<{ status: string }>("/notifications/read", { method: "PATCH" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
    },
  })
}
