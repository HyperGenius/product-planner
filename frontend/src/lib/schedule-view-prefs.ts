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
  /** 折りたたみ中のグループ行の id */
  collapsedGroupIds: string[]
}

export const SCHEDULE_VIEW_PREFS_STORAGE_KEY = "schedule-view-prefs"

export const DEFAULT_SCHEDULE_VIEW_PREFS: ScheduleViewPrefs = {
  viewMode: "Week",
  groupBy: "order",
  equipmentGroupId: null,
  collapsedGroupIds: [],
}

/** 覚えておく折りたたみの上限。注文は増え続けるので、古いもの（先に折りたたんだもの）から捨てる */
export const MAX_COLLAPSED_GROUP_IDS = 300

const VIEW_MODES: readonly GanttViewMode[] = ["Day", "Week", "Month"]
const GROUP_BY_MODES: readonly GroupByMode[] = ["order", "equipment_group", "none"]

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value)
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
    collapsedGroupIds: Array.isArray(v.collapsedGroupIds)
      ? v.collapsedGroupIds.filter((id): id is string => typeof id === "string").slice(-MAX_COLLAPSED_GROUP_IDS)
      : [],
  }
}
