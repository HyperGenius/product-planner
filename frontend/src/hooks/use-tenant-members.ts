"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { createClient } from "@/utils/supabase/client"
import type { TenantMember, MemberCreate, MemberUpdate } from "@/types/member"

const MEMBERS_QUERY_KEY = ["tenant-members"]

/**
 * テナントメンバー一覧を取得するフック
 */
export function useTenantMembers() {
  return useQuery<TenantMember[]>({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: () => apiClient<TenantMember[]>("/tenant/members"),
  })
}

/**
 * メンバーを追加するフック
 */
export function useCreateTenantMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: MemberCreate) =>
      apiClient<TenantMember>("/tenant/members", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY })
    },
  })
}

/**
 * メンバーを更新するフック
 */
export function useUpdateTenantMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: MemberUpdate }) =>
      apiClient<TenantMember>(`/tenant/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY })
    },
  })
}

/**
 * 現在ログイン中のユーザーのテナントメンバー情報を取得するフック
 */
export function useCurrentMember() {
  const { data: members } = useTenantMembers()
  return useQuery({
    queryKey: ["current-member"],
    queryFn: async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      return user ?? null
    },
    select: (user) => members?.find((m) => m.user_id === user?.id) ?? null,
  })
}

/**
 * メンバーを削除するフック
 */
export function useDeleteTenantMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (userId: string) =>
      apiClient(`/tenant/members/${userId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY })
    },
  })
}
