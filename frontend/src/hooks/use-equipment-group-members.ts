"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { Equipment } from "@/types/equipment"

export interface EquipmentGroupMember {
  id: number
  equipment_group_id: number
  equipment_id: number
}

const ALL_MEMBERS_KEY = ["equipment-group-members"]
const getEquipmentGroupMembersKey = (groupId: number) => ["equipment-group-members", groupId]

/**
 * 全equipment_group_membersを一括取得するフック
 * 設備一覧の「所属グループ」列表示に使用
 */
export function useAllEquipmentGroupMembers() {
  return useQuery<EquipmentGroupMember[]>({
    queryKey: ALL_MEMBERS_KEY,
    queryFn: () => apiClient<EquipmentGroupMember[]>("/equipment-groups/members"),
  })
}

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
    onSuccess: () => {
      // ALL_MEMBERS_KEY のprefixで全件キャッシュ（特定グループ含む）を一括無効化
      queryClient.invalidateQueries({ queryKey: ALL_MEMBERS_KEY })
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
    onSuccess: () => {
      // ALL_MEMBERS_KEY のprefixで全件キャッシュ（特定グループ含む）を一括無効化
      queryClient.invalidateQueries({ queryKey: ALL_MEMBERS_KEY })
    },
  })
}
