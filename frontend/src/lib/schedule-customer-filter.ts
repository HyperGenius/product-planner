import { scheduleCustomerLabel } from "@/lib/schedule-label-utils"
import type { Schedule } from "@/types/schedule"

/**
 * 生産スケジュールの顧客の絞り込み（Issue #597）。選択肢は表示中の期間のスケジュールに出てくる顧客で、
 * 絞り込みはフロントで行う（API は期間・設備グループで取得したものを全顧客分返す）
 */

/** 選んだ顧客。`customerId` が null は顧客不明（#521）。期間を移して予定が無くなっても名前を出せるよう表示名も覚える */
export interface ScheduleCustomerFilter {
  customerId: number | null
  label: string
}

export interface ScheduleCustomerOption extends ScheduleCustomerFilter {
  /** 検索で当てる語（通称・正式名称） */
  keywords: string[]
}

type CustomerFields = Pick<Schedule, "customer_id" | "customer_name" | "customer_alias">

const customerIdOf = (schedule: CustomerFields) => schedule.customer_id ?? null

/** 表示中のスケジュールに出てくる顧客。表示名の順で、顧客不明は最後 */
export function listScheduleCustomers(schedules: readonly CustomerFields[]): ScheduleCustomerOption[] {
  const byId = new Map<number | null, ScheduleCustomerOption>()
  for (const schedule of schedules) {
    const customerId = customerIdOf(schedule)
    if (byId.has(customerId)) continue
    const label = scheduleCustomerLabel(schedule)
    byId.set(customerId, {
      customerId,
      label,
      // 表示名（顧客不明なら「顧客不明」）と正式名称
      keywords: [...new Set([label, schedule.customer_name].filter((k): k is string => !!k))],
    })
  }
  return [...byId.values()].sort((a, b) => {
    if ((a.customerId === null) !== (b.customerId === null)) return a.customerId === null ? 1 : -1
    return a.label.localeCompare(b.label, "ja")
  })
}

/**
 * 選択肢に、選んでいる顧客が無ければ足す（期間を移して予定が無くなっても選択を外さず、選び直せるようにする）
 */
export function withSelectedCustomer(
  options: ScheduleCustomerOption[],
  selected: ScheduleCustomerFilter | null,
): ScheduleCustomerOption[] {
  if (!selected || options.some((o) => o.customerId === selected.customerId)) return options
  return [...options, { ...selected, keywords: [selected.label] }]
}

/** 選んだ顧客のスケジュールだけにする。null（すべて）ならそのまま */
export function filterSchedulesByCustomer<T extends CustomerFields>(
  schedules: T[],
  selected: ScheduleCustomerFilter | null,
): T[] {
  if (!selected) return schedules
  return schedules.filter((s) => customerIdOf(s) === selected.customerId)
}
