/**
 * 日報の名寄せ（未照合キュー・別名辞書）の型 (Issue #488 / #489)。
 * Backend `app/models/daily_report_names.py` と揃える。
 */
import type { Order } from "@/types/order"
import type { ProductNameAliasHistoryEntry } from "@/types/product"

/** 照合する表記の種別 */
export type NameKind = "equipment" | "process" | "customer" | "product"

/** 画面に並べる順。製品の別名は顧客単位なので、顧客を製品より先に片付けられるようにする */
export const NAME_KINDS: NameKind[] = ["equipment", "process", "customer", "product"]

export const NAME_KIND_LABELS: Record<NameKind, string> = {
  equipment: "設備",
  process: "工程",
  customer: "顧客",
  product: "製品",
}

/** 照合できなかった表記（GET /daily-reports/unmatched-names）。出現件数の多い順に返る */
export interface UnmatchedName {
  kind: NameKind
  raw_text: string
  /** 製品のみ: 顧客先の表記（空欄なら null） */
  customer_raw: string | null
  /** 製品のみ: 顧客先の照合結果。null なら先に顧客の対応付けが要る */
  customer_id: number | null
  entry_count: number
  /** 日付のみ（"YYYY-MM-DD"） */
  last_work_date: string | null
}

/** 表記が使われている日報の明細（GET /daily-reports/name-entries） */
export interface NameEntry {
  id: number
  sheet_name: string
  row_no: number
  /** 日付のみ（"YYYY-MM-DD"） */
  work_date: string | null
  customer_raw: string | null
  product_raw: string | null
  process_raw: string | null
  equipment_raw: string | null
  worker_raw: string | null
  processed_qty: number | null
  defect_qty: number | null
  good_qty: number | null
}

/** 日報の商品名に似た製品（pg_trgm）。提示専用で自動確定はしない */
export interface ProductCandidate {
  product_id: number
  name: string
  score: number
  /** その顧客の割り付け対象（確定済み・生産中）の受注件数。顧客を指定したときだけ入る (Issue #646) */
  open_order_count?: number
  /** 上記の受注のうち最寄りの希望納期（日付のみ "YYYY-MM-DD"）。受注が無ければ無い */
  nearest_deadline?: string
}

/** 顧客の未出荷の受注（名寄せ画面の表示専用、Issue #646） */
export interface CustomerOpenOrder {
  order_id: number
  order_number: string | null
  customer_order_no: string | null
  product_id: number
  product_name: string
  quantity: number | null
  /** 日付のみ ("YYYY-MM-DD") */
  desired_deadline: string | null
  status: Order["status"]
  /** 割り付けの候補（確定済み・生産中）か。違う受注には実績は充当されない */
  allocatable: boolean
}

interface NameAliasBase {
  id: string
  raw_text: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface EquipmentNameAlias extends NameAliasBase {
  equipment_id: number
}

export interface ProcessNameAlias extends NameAliasBase {
  /** マスタの工程名（1つの表記が複数の工程を指しうる） */
  process_names: string[]
}

export interface CustomerNameAlias extends NameAliasBase {
  customer_id: number
}

/** 製品の別名（product_name_aliases、顧客単位）。メール起票由来の別名も含む */
export interface ProductNameAlias {
  id: string
  customer_id: number
  raw_text: string
  product_id: number
  source: ProductNameAliasHistoryEntry["source"]
  created_at: string
  updated_at: string
}

export interface NameAliasByKind {
  equipment: EquipmentNameAlias
  process: ProcessNameAlias
  customer: CustomerNameAlias
  product: ProductNameAlias
}

/** 別名の登録内容（POST /daily-reports/name-aliases/{kind}） */
export interface NameAliasCreateByKind {
  equipment: { raw_text: string; equipment_id: number }
  process: { raw_text: string; process_names: string[] }
  customer: { raw_text: string; customer_id: number }
  product: { raw_text: string; customer_id: number; product_id: number }
}

/** 「対象外」にした表記（未照合キューに出さない） */
export interface IgnoredName {
  id: string
  kind: NameKind
  raw_text: string
  /** 製品のみ: 顧客先の表記 */
  customer_raw: string | null
  created_by: string
  created_at: string
}
