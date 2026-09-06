"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type {
  TenantMember,
  MemberCreate,
  MemberUpdate,
  MemberPasswordResetResponse,
} from "@/types/member"

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
 * 現在ログイン中のユーザー自身のテナントメンバー情報（自分のロール等）を取得するフック
 *
 * `GET /tenant/members`（一覧）は president / platform_admin 限定のため、
 * それ以外のロールのユーザーが自分のロールを知りたい場合（画面の表示制御等）は
 * ロール制限のない `GET /tenant/members/me` を使う。
 */
export function useCurrentMember() {
  return useQuery<TenantMember | null>({
    queryKey: ["current-member"],
    queryFn: () => apiClient<TenantMember>("/tenant/members/me"),
  })
}

/**
 * 対象メンバーのパスワードを再設定するフック（president / platform_admin のみ）。
 * 新パスワードはフロントで生成して送信し、レスポンスの `new_password` を
 * 一度だけ表示して president が本人へ共有する（メール送信基盤がないため）。
 */
export function useResetMemberPassword() {
  return useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      apiClient<MemberPasswordResetResponse>(
        `/tenant/members/${userId}/password/reset`,
        {
          method: "POST",
          body: JSON.stringify({ password }),
        }
      ),
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
