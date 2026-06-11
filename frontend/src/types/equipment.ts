export interface Equipment {
  id: number
  name: string
  tenant_id: string
  created_at: string
  updated_at: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}

export interface EquipmentCreate {
  name: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}

export interface EquipmentUpdate {
  name: string
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}
