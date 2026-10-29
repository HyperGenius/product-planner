import type { ScheduleCustomerFilter } from "@/lib/schedule-customer-filter"
import type { GanttViewMode, GroupByMode } from "@/types/schedule"

/**
 * 生産スケジュール画面の表示の選択（Issue #581）。置きっぱなしのタブレットを開き直しても同じ表示に戻すため
 * localStorage に覚える（`useLocalStorageState()`）
 */
export interface ScheduleViewPrefs {
  viewMode: GanttViewMode
  groupBy: GroupByMode
  /** 設備グループの絞り込み。null は「すべて」 */
  equipmentGroupId: number | null
  /** 顧客の絞り込み（Issue #597）。null は「すべて」 */
  customer: ScheduleCustomerFilter | null
  /** 折りたたみ中のグループ行の id */
  collapsedGroupIds: string[]
  /** 凡例を開いているか（Issue #589）。保存値が無い初回は開き、新しいアイコンの意味を最初に見せる */
  legendOpen: boolean
}

export const SCHEDULE_VIEW_PREFS_STORAGE_KEY = "schedule-view-prefs"

export const DEFAULT_SCHEDULE_VIEW_PREFS: ScheduleViewPrefs = {
  viewMode: "Week",
  groupBy: "order",
  equipmentGroupId: null,
  customer: null,
  collapsedGroupIds: [],
  legendOpen: true,
}

/** 覚えておく折りたたみの上限。注文は増え続けるので、古いもの（先に折りたたんだもの）から捨てる */
export const MAX_COLLAPSED_GROUP_IDS = 300

const VIEW_MODES: readonly GanttViewMode[] = ["Day", "Week", "Month"]
const GROUP_BY_MODES: readonly GroupByMode[] = ["order", "equipment_group", "none"]

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
}

function parseCustomer(value: unknown): ScheduleCustomerFilter | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  const customerId = v.customerId
  if (customerId !== null && !(typeof customerId === "number" && Number.isInteger(customerId))) return null
  if (typeof v.label !== "string" || v.label === "") return null
  return { customerId, label: v.label }
}

/**
 * 保存済みの値の検証。古い版・手で編集された値かもしれないので、項目ごとに既知の値だけを採り、
 * 外れた項目は既定値に戻す
 */
export function parseScheduleViewPrefs(value: unknown): ScheduleViewPrefs | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  return {
    viewMode: isOneOf(VIEW_MODES, v.viewMode) ? v.viewMode : DEFAULT_SCHEDULE_VIEW_PREFS.viewMode,
    groupBy: isOneOf(GROUP_BY_MODES, v.groupBy) ? v.groupBy : DEFAULT_SCHEDULE_VIEW_PREFS.groupBy,
    equipmentGroupId:
      typeof v.equipmentGroupId === "number" && Number.isInteger(v.equipmentGroupId) ? v.equipmentGroupId : null,
    customer: parseCustomer(v.customer),
    collapsedGroupIds: Array.isArray(v.collapsedGroupIds)
      ? v.collapsedGroupIds.filter((id): id is string => typeof id === "string").slice(-MAX_COLLAPSED_GROUP_IDS)
      : [],
    legendOpen: typeof v.legendOpen === "boolean" ? v.legendOpen : DEFAULT_SCHEDULE_VIEW_PREFS.legendOpen,
  }
}
