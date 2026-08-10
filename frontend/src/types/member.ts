export type MemberRole = "president" | "iso_officer" | "order_handler"

export interface TenantMember {
  user_id: string
  email: string
  full_name: string | null
  role: MemberRole
}

export interface MemberCreate {
  email: string
  password: string
  full_name: string
  role: MemberRole
}

export interface MemberUpdate {
  full_name?: string
  role?: MemberRole
}
