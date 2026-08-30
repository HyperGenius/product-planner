export type NotificationType =
  | "no_product_match"
  | "downgrade_skipped"
  | "draft_conflict_skipped"
  | "failed_encrypted"
  | "failed_image"
  | "non_order_email"
  | "customer_draft_created"
  | "multi_order_suspected"
  | "approval_requested"
  | "no_order_created"

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
