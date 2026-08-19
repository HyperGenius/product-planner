"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { DEVICE_ID_STORAGE_KEY } from "@/lib/device-auth-client"
import type { DeviceRegisterResponse, DeviceTrust } from "@/types/device"

const DEVICES_QUERY_KEY = ["device-trusts"]

/**
 * テナントの信頼済み端末一覧を取得するフック（president / platform_admin のみ）
 */
export function useDeviceTrusts() {
  return useQuery<DeviceTrust[]>({
    queryKey: DEVICES_QUERY_KEY,
    queryFn: () => apiClient<DeviceTrust[]>("/auth/device"),
  })
}

/**
 * 現在使用中の端末をこのテナントの信頼済み端末として登録するフック。
 * 成功時、発行された device_id を localStorage に保存する。
 */
export function useRegisterDevice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      apiClient<DeviceRegisterResponse>("/auth/device/register", {
        method: "POST",
      }),
    onSuccess: (data) => {
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, data.device_id)
      queryClient.invalidateQueries({ queryKey: DEVICES_QUERY_KEY })
    },
  })
}

/**
 * 端末信頼を失効させるフック
 */
export function useRevokeDevice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (deviceId: string) =>
      apiClient(`/auth/device/${deviceId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEVICES_QUERY_KEY })
    },
  })
}
