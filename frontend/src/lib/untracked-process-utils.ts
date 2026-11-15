import type { UntrackedProcessName } from "@/types/process-routing"

/**
 * 日報で追わない工程（Issue #681）の判定。工程名は前後の空白を除いて比べる
 * （Backend `daily_report_allocator.is_untracked()` と揃える。全角の空白も除く）
 */

/** 工程名の比較キー */
export function normalizeProcessName(name: string | null | undefined): string {
  return (name ?? "").trim()
}

/** 設定の一覧を、比較キーの集合にする */
export function toUntrackedNameSet(
  items: readonly UntrackedProcessName[] | undefined,
): ReadonlySet<string> {
  return new Set((items ?? []).map((i) => normalizeProcessName(i.process_name)).filter(Boolean))
}

/** 日報で追わない工程か */
export function isUntrackedProcessName(
  names: ReadonlySet<string> | undefined,
  processName: string | null | undefined,
): boolean {
  const key = normalizeProcessName(processName)
  return key !== "" && (names?.has(key) ?? false)
}

/** 設定の一覧から、工程名に当たる設定を探す（解除に id が要る） */
export function findUntrackedProcessName(
  items: readonly UntrackedProcessName[] | undefined,
  processName: string | null | undefined,
): UntrackedProcessName | undefined {
  const key = normalizeProcessName(processName)
  if (!key) return undefined
  return items?.find((i) => normalizeProcessName(i.process_name) === key)
}

/** 日報で追わない工程の表示名 */
export const UNTRACKED_PROCESS_LABEL = "日報の対象外"
