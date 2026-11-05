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

/** 未対応の依頼の一覧の1行（Issue #622）。未紐づけは order_id が null */
export interface OpenDeliveryRequestListItem extends OrderDeliveryRequest {
  order_number: string | null
  customer_name: string | null
  /** 受注の現状（Issue #635）。未紐づけは null。日付は日付のみ（"YYYY-MM-DD"）で `parseISO()` で読む */
  order_quantity: number | null
  desired_deadline: string | null
  confirmed_deadline: string | null
  simulated_deadline: string | null
}
