import { format, parseISO } from "date-fns"
import { pickShippingDeadline } from "@/lib/shipping-candidate-utils"
import type { Schedule } from "@/types/schedule"

/**
 * 生産スケジュールのガントのラベル（Issue #579）。注文行に「どの客の何を何個、いつまでに」を出す
 */

/** 顧客不明（`customer_id` が NULL、#521）の表示 */
export const UNKNOWN_CUSTOMER_LABEL = "顧客不明"

type OrderFields = Pick<
  Schedule,
  | "order_id"
  | "order_number"
  | "customer_order_no"
  | "customer_name"
  | "product_name"
  | "quantity"
  | "desired_deadline"
  | "confirmed_deadline"
>

export function scheduleCustomerLabel(schedule: Pick<Schedule, "customer_name">): string {
  return schedule.customer_name || UNKNOWN_CUSTOMER_LABEL
}

/** 注文番号。無ければ顧客の注文番号、それも無ければ内部 ID */
export function scheduleOrderNumberLabel(
  schedule: Pick<Schedule, "order_id" | "order_number" | "customer_order_no">,
): string {
  return schedule.order_number || schedule.customer_order_no || `#${schedule.order_id}`
}

/**
 * 納期の表示（`M/d`）。基準は「送品の消し込み」と同じ希望納期 → 無ければ完成見込みで、
 * 完成見込みのときは「見込」と出して区別する
 */
export function scheduleDeadlineLabel(
  schedule: Pick<Schedule, "desired_deadline" | "confirmed_deadline">,
): string | null {
  const deadline = pickShippingDeadline(schedule.desired_deadline, schedule.confirmed_deadline)
  if (!deadline) return null
  const date = format(parseISO(deadline.date), "M/d")
  return deadline.source === "desired" ? `納期 ${date}` : `見込 ${date}`
}

/** 注文行の2行目（数量・納期・注文番号）。値の無い項目は出さない */
export function scheduleOrderMeta(schedule: OrderFields): string[] {
  const deadline = scheduleDeadlineLabel(schedule)
  return [
    schedule.quantity != null ? `${schedule.quantity.toLocaleString("ja-JP")}個` : null,
    deadline,
    scheduleOrderNumberLabel(schedule),
  ].filter((part): part is string => part !== null)
}

/** 注文を表す1行（顧客名・製品名）。工程行・ツールチップで使う */
export function scheduleOrderTitle(schedule: Pick<Schedule, "customer_name" | "product_name">): string {
  return [scheduleCustomerLabel(schedule), schedule.product_name].filter(Boolean).join(" ")
}
