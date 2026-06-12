"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { SchedulingSettings, SchedulingSettingsUpdate } from "@/types/scheduling-settings"

const SCHEDULING_SETTINGS_KEY = ["scheduling-settings"]

export function useSchedulingSettings() {
  return useQuery<SchedulingSettings>({
    queryKey: SCHEDULING_SETTINGS_KEY,
    queryFn: () => apiClient<SchedulingSettings>("/scheduling-settings"),
  })
}

export function useUpdateSchedulingSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: SchedulingSettingsUpdate) =>
      apiClient<SchedulingSettings>("/scheduling-settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SCHEDULING_SETTINGS_KEY })
    },
  })
}
