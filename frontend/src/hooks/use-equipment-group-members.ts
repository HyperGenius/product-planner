"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { Equipment } from "@/types/equipment"

/**
 * 設備グループメンバーの型定義
 */
export interface EquipmentGroupMember {
  id: number
  equipment_group_id: number
  equipment_id: number
}

// クエリキーを定数化
const getEquipmentGroupMembersKey = (groupId: number) => ["equipment-group-members", groupId]

/**
 * 設備グループに所属する設備一覧を取得するフック
 */
export function useEquipmentGroupMembers(groupId: number) {
  return useQuery<Equipment[]>({
    queryKey: getEquipmentGroupMembersKey(groupId),
    queryFn: () => apiClient<Equipment[]>(`/equipment-groups/${groupId}/members`),
    enabled: groupId > 0,
  })
}

/**
 * 設備グループに設備を追加するフック
 */
export function useAddEquipmentToGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ groupId, equipmentId }: { groupId: number; equipmentId: number }) =>
      apiClient<EquipmentGroupMember>(`/equipment-groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify({ equipment_id: equipmentId }),
      }),
    onSuccess: (_, variables) => {
      // 該当グループのメンバー一覧を再取得
      queryClient.invalidateQueries({ queryKey: getEquipmentGroupMembersKey(variables.groupId) })
    },
  })
}

/**
 * 設備グループから設備を削除するフック
 */
export function useRemoveEquipmentFromGroup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ groupId, equipmentId }: { groupId: number; equipmentId: number }) =>
      apiClient<{ status: string }>(`/equipment-groups/${groupId}/members/${equipmentId}`, {
        method: "DELETE",
      }),
    onSuccess: (_, variables) => {
      // 該当グループのメンバー一覧を再取得
      queryClient.invalidateQueries({ queryKey: getEquipmentGroupMembersKey(variables.groupId) })
    },
  })
}
