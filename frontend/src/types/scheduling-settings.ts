export interface SchedulingSettings {
  tenant_id?: string
  guard_time_minutes: number
  min_slot_minutes: number
  max_fragments: number
}

export interface SchedulingSettingsUpdate {
  guard_time_minutes?: number | null
  min_slot_minutes?: number | null
  max_fragments?: number | null
}
