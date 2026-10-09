import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

export interface EquipmentGroup {
  id: number
  name: string
  organization_id: string
  created_at: string
  updated_at: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
  member_names: string[]
  member_count: number
  /** このグループを参照している工程（process_routings）の数 */
  routing_count: number
}

export interface EquipmentGroupCreate {
  name: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}

export interface EquipmentGroupUpdate {
  name: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}

export const EQUIPMENT_GROUPS_KEY = ['equipment-groups']

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

function formatMemberNames(names: string[], max = 3): string {
  if (names.length <= max) return names.join(' / ')
  return `${names.slice(0, max).join(' / ')} 他${names.length - max}台`
}

/**
 * 画面に出すグループ名。1台のグループは、グループ名ではなくメンバーの設備の表示名（呼称優先）を出す。
 * 1台グループの名前は設備名・呼称を変えても追従しないため（Issue #512）
 */
export function groupDisplayName(group: Pick<EquipmentGroup, 'name' | 'member_names'>): string {
  return group.member_names.length === 1 ? group.member_names[0] : group.name
}

/** 工程ルーティングの選択肢のラベル。複数台のグループはメンバーの設備名を補足する */
export function formatGroupLabel(group: Pick<EquipmentGroup, 'name' | 'member_names'>): string {
  if (group.member_names.length === 0) return `${group.name}（メンバー未登録・設備なしで計画）`
  if (group.member_names.length === 1) return group.member_names[0]
  return `${group.name} (${formatMemberNames(group.member_names)})`
}

export interface RoutingGroupOptionSection<T> {
  label: string
  groups: T[]
}

/**
 * 工程ルーティングの設備グループの選択肢を、複数台のグループ・設備（1台のグループ）・メンバー未登録の
 * グループに分けて表示名順に並べる（Issue #512）。
 * メンバー0台のグループは、工程から参照されているもの（スケジューラーは設備なしとして扱う）と
 * 編集中の工程が選んでいるものだけを残す。参照の無い0台のグループは設備の削除で残った残骸なので出さない
 */
export function routingGroupOptionSections<
  T extends Pick<EquipmentGroup, 'id' | 'name' | 'member_names' | 'routing_count'>,
>(groups: T[], selectedId: number | null | ''): RoutingGroupOptionSection<T>[] {
  const byLabel = (a: T, b: T) => groupDisplayName(a).localeCompare(groupDisplayName(b), 'ja')
  const shared = groups.filter((g) => g.member_names.length >= 2).sort(byLabel)
  const single = groups.filter((g) => g.member_names.length === 1).sort(byLabel)
  const empty = groups
    .filter((g) => g.member_names.length === 0 && (g.routing_count > 0 || g.id === selectedId))
    .sort(byLabel)
  return [
    { label: '設備グループ（複数台）', groups: shared },
    { label: '設備', groups: single },
    { label: 'メンバー未登録（設備なしで計画）', groups: empty },
  ].filter((section) => section.groups.length > 0)
}

/**
 * 設備マスタのグループ管理タブに出すグループ。
 * 既定は2台以上の共有グループだけ（1台のグループは設備一覧で見えるため、Issue #192）で、
 * `includeSmall` なら1台以下（0台を含む）のグループも出す。メンバーの欠けた工程用グループや、
 * 設備の削除で残った0台のグループを画面から見つけて直せるようにする（Issue #512）
 */
export function groupsForManagement<T extends Pick<EquipmentGroup, 'member_count'>>(
  groups: T[],
  includeSmall: boolean,
): T[] {
  if (includeSmall) return groups
  return groups.filter((g) => g.member_count >= 2)
}
