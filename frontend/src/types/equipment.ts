/** 設備台帳（顧客の正典）の情報。Backend `EquipmentBase` と揃える（Issue #486） */
export interface EquipmentLedgerFields {
  /** 台帳番号（テナント内で一意）。台帳に無い設備は null */
  ledger_no?: number | null
  maker?: string | null
  model?: string | null
  /** 製造年月（台帳の表記のまま。例: 1993年5月 / S.53年11月） */
  manufactured_on?: string | null
  serial_no?: string | null
  note?: string | null
}

export interface Equipment extends EquipmentLedgerFields {
  id: number
  name: string
  tenant_id: string
  created_at: string
  updated_at: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}

export interface EquipmentCreate extends EquipmentLedgerFields {
  name: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}

export interface EquipmentUpdate extends EquipmentLedgerFields {
  name: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}
