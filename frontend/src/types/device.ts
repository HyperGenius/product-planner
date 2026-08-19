export interface DeviceTrust {
  device_id: string
  registered_by: string
  created_at: string
  expires_at: string
  revoked_at: string | null
}

export interface DeviceRegisterResponse {
  device_id: string
  expires_at: string
}

export interface DeviceMemberOption {
  user_id: string
  full_name: string | null
}

export interface DeviceStatusResponse {
  trusted: boolean
  tenant_id: string | null
  members: DeviceMemberOption[]
}

export interface PinLoginResponse {
  access_token: string
  refresh_token: string
}
