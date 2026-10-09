"use client"

import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { ALL_MEMBERS_KEY } from "@/hooks/use-equipment-group-members"
import { EQUIPMENT_GROUPS_KEY } from "@/lib/hooks/use-equipment-groups"
import type { Equipment, EquipmentCreate, EquipmentUpdate } from "@/types/equipment"

// クエリキーを定数化
const EQUIPMENTS_QUERY_KEY = ["equipments"]

/**
 * 設備の作成・更新・削除後に再取得するクエリ。設備の作成では DB のトリガーが1台グループを作り、
 * 名前の変更はグループの member_names に、削除はメンバーに及ぶので、グループ側も再取得する（Issue #512）
 */
function invalidateEquipmentQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: EQUIPMENTS_QUERY_KEY })
  queryClient.invalidateQueries({ queryKey: EQUIPMENT_GROUPS_KEY })
  queryClient.invalidateQueries({ queryKey: ALL_MEMBERS_KEY })
}

/**
 * 設備一覧を取得するフック
 */
export function useEquipments() {
  return useQuery<Equipment[]>({
    queryKey: EQUIPMENTS_QUERY_KEY,
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
      invalidateEquipmentQueries(queryClient)
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
      invalidateEquipmentQueries(queryClient)
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
      invalidateEquipmentQueries(queryClient)
    },
  })
}
