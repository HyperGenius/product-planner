/* frontend/src/lib/device-auth-client.ts */
import type { DeviceStatusResponse, PinLoginResponse } from "@/types/device"
import { ApiError } from "@/lib/api-client"

export const DEVICE_ID_STORAGE_KEY = "deviceId"

/**
 * ログイン画面（未ログイン状態）から呼び出す端末認証系エンドポイント用のクライアント。
 * apiClient とは異なり、セッションJWTの取得を前提としない（そもそもログイン前に使うため）。
 */
async function deviceAuthFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new ApiError(response.status, errorData)
  }

  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T
  }

  return response.json()
}

export function getStoredDeviceId(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(DEVICE_ID_STORAGE_KEY)
}

export function fetchDeviceStatus(deviceId: string): Promise<DeviceStatusResponse> {
  return deviceAuthFetch<DeviceStatusResponse>(
    `/auth/device/status?device_id=${encodeURIComponent(deviceId)}`
  )
}

export function pinLogin(
  deviceId: string,
  userId: string,
  pin: string
): Promise<PinLoginResponse> {
  return deviceAuthFetch<PinLoginResponse>("/auth/device/pin-login", {
    method: "POST",
    body: JSON.stringify({ device_id: deviceId, user_id: userId, pin }),
  })
}
