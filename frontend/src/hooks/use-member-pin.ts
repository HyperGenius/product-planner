"use client"

import { useMutation } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"

/**
 * 自分自身のPINを設定/変更するフック
 */
export function useSetMyPin() {
  return useMutation({
    mutationFn: (pin: string) =>
      apiClient("/tenant/members/me/pin", {
        method: "PATCH",
        body: JSON.stringify({ pin }),
      }),
  })
}

/**
 * 対象メンバーのPINを削除する（president / platform_admin のみ）フック。
 * 本人が再設定するまでPINログインは利用できなくなる（パスワードでの復旧経路を残す操作）。
 */
export function useResetMemberPin() {
  return useMutation({
    mutationFn: (userId: string) =>
      apiClient(`/tenant/members/${userId}/pin/reset`, { method: "POST" }),
  })
}
