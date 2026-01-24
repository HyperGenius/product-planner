"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { Equipment, EquipmentCreate, EquipmentUpdate } from "@/types/equipment"

/**
 * 設備一覧を取得するフック
 */
export function useEquipments() {
  return useQuery<Equipment[]>({
    queryKey: ["equipments"],
    queryFn: () => apiClient<Equipment[]>("/equipments"),
  })
}

/**
 * 設備を作成するフック
 */
export function useCreateEquipment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: EquipmentCreate) =>
      apiClient<Equipment>("/equipments", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 設備一覧を再取得
      queryClient.invalidateQueries({ queryKey: ["equipments"] })
    },
  })
}

/**
 * 設備を更新するフック
 */
export function useUpdateEquipment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: EquipmentUpdate }) =>
      apiClient<Equipment>(`/equipments/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 設備一覧を再取得
      queryClient.invalidateQueries({ queryKey: ["equipments"] })
    },
  })
}

/**
 * 設備を削除するフック
 */
export function useDeleteEquipment() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) =>
      apiClient(`/equipments/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      // 設備一覧を再取得
      queryClient.invalidateQueries({ queryKey: ["equipments"] })
    },
  })
}
