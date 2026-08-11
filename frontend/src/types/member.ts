export type MemberRole =
  | "president"
  | "iso_officer"
  | "order_handler"
  | "platform_admin"

/**
 * 承認監査ログ（/orders/approval-logs）の閲覧を許可するロール。
 * ページ側の `canView` 判定とサイドバーメニューの表示制御で共通利用する。
 */
export const ORDER_APPROVAL_LOG_VIEWER_ROLES: MemberRole[] = [
  "iso_officer",
  "president",
  "platform_admin",
]

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
