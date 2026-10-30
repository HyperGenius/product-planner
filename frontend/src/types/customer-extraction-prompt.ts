/**
 * 顧客ごとの抽出指示の編集・試し読み（Issue #602）。
 * Backend `models/master/customer_extraction_prompt_schemas.py` と揃える。
 */
import type { Order } from "@/types/order"

/** 抽出指示の文字数の上限。Backend `EXTRACTION_PROMPT_MAX_LENGTH` と揃える */
export const EXTRACTION_PROMPT_MAX_LENGTH = 2000

export interface ExtractionPrompt {
  customer_id: number
  customer_name: string
  prompt: string | null
  max_length: number
}

export interface ExtractionPromptSaveResult {
  prompt: string | null
  /** 今の指示と同じ内容だった（履歴を追記しなかった）ときは false */
  changed: boolean
}

export interface ExtractionPromptHistoryItem {
  id: number
  /** null は空に戻した（汎用プロンプトのみ）版 */
  prompt: string | null
  /** null は画面以外で入った値（移行時点の値・SQL での直接変更） */
  changed_by: string | null
  changed_at: string
}

export interface ExtractionPromptAttachment {
  id: string
  original_filename: string
  size_bytes: number | null
  received_at: string
}

export interface PreviewProduct {
  id: number
  code: string | null
  name: string
}

export interface PreviewLineItem {
  product_name_raw: string | null
  product_number_raw: string | null
  quantity: number | null
  /** 数量が整数でない明細（取り込みでは起票しない） */
  invalid_quantity: boolean
  delivery_date: string | null
  certainty: NonNullable<Order["customer_certainty"]> | null
  line_order_no: string | null
  /** 起票時に受注の顧客注文番号に入る値 */
  customer_order_no: string | null
  /** null は未照合（取り込みでは製品未照合の下書きになる） */
  product: PreviewProduct | null
}

export interface PreviewReading {
  /** Claude が文書を受け付けなかった */
  error: "document_rejected" | null
  document_order_no: string | null
  is_repair: boolean
  subject: string | null
  line_items: PreviewLineItem[]
  /** 明細が取れなかったときに取り込みが代わりに行うこと */
  fallback: "email_body" | "unreadable_draft" | null
}

export interface ExtractionPreview {
  source: "text" | "image" | null
  /** 指示に関係なく読めないPDF */
  unreadable_reason: "failed_encrypted" | "failed_too_large" | null
  current: PreviewReading | null
  edited: PreviewReading | null
  /** 今の指示と編集中の指示が同じ（1回だけ読み取った） */
  same_prompt: boolean
}

export interface ExtractionPreviewRequest {
  attachment_id: string
  prompt: string | null
}
