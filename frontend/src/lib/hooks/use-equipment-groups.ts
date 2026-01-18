import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

export interface EquipmentGroup {
  id: number
  name: string
  organization_id: string
  created_at: string
  updated_at: string
}

export interface EquipmentGroupCreate {
  name: string
}

export interface EquipmentGroupUpdate {
  name: string
}

const EQUIPMENT_GROUPS_KEY = ['equipment-groups']

// 一覧取得
export function useEquipmentGroups() {
  return useQuery({
    queryKey: EQUIPMENT_GROUPS_KEY,
    queryFn: () => apiClient<EquipmentGroup[]>('/equipment-groups'),
  })
}

// 作成
export function useCreateEquipmentGroup() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (data: EquipmentGroupCreate) =>
      apiClient<EquipmentGroup>('/equipment-groups', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENT_GROUPS_KEY })
    },
  })
}

// 更新
export function useUpdateEquipmentGroup() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: EquipmentGroupUpdate }) =>
      apiClient<EquipmentGroup>(`/equipment-groups/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENT_GROUPS_KEY })
    },
  })
}

// 削除
export function useDeleteEquipmentGroup() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: (id: number) =>
      apiClient<{ status: string }>(`/equipment-groups/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENT_GROUPS_KEY })
    },
  })
}
