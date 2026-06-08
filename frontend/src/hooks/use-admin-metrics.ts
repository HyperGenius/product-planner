"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { WeeklyConfirmation } from "@/types/admin"

export function useWeeklyConfirmations() {
  return useQuery<WeeklyConfirmation[]>({
    queryKey: ["admin", "weekly-confirmations"],
    queryFn: () => apiClient<WeeklyConfirmation[]>("/admin/metrics/weekly-confirmations"),
    staleTime: 1000 * 60 * 5,
    retry: false,
  })
}
