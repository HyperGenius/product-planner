/**
 * 顧客からの督促・分割納入の依頼の型 (Issue #619)。
 * Backend の `app/models/transaction/delivery_request_schema.py` と一致させること。
 */

export type DeliveryRequestKind = "delivery_chase" | "split_delivery"

export interface OrderDeliveryRequest {
  id: string
  order_id: number | null
  kind: DeliveryRequestKind
  extracted_product_name: string | null
  quantity: number | null
  /** 日付のみ（"YYYY-MM-DD"）。`parseISO()` で読む */
  requested_date: string | null
  body_snippet: string | null
  resolved_at: string | null
  created_at: string
}

export interface OpenDeliveryRequestCount {
  order_id: number
  count: number
}
