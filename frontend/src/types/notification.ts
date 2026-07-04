export type NotificationType =
  | "no_product_match"
  | "downgrade_skipped"
  | "draft_conflict_skipped"
  | "failed_encrypted"
  | "failed_image"
  | "non_order_email"

export interface Notification {
  id: string
  notif_type: NotificationType
  source_table: string
  source_id: string | null
  detail: Record<string, unknown> | null
  read_at: string | null
  created_at: string
  link_url: string | null
}
