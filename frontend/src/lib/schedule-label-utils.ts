import { addDays, format, parseISO } from "date-fns"
import { pickShippingDeadline } from "@/lib/shipping-candidate-utils"
import type { Schedule } from "@/types/schedule"

/**
 * 生産スケジュールのガントのラベル（Issue #579）。注文行には「どの客の何を何個」だけを出し（Issue #589）、
 * 納期は納期マーカー、注文番号などは詳細シートで見る
 */

/** 顧客不明（`customer_id` が NULL、#521）の表示 */
export const UNKNOWN_CUSTOMER_LABEL = "顧客不明"

type OrderFields = Pick<
  Schedule,
  | "order_id"
  | "order_number"
  | "customer_order_no"
  | "customer_name"
  | "customer_alias"
  | "product_name"
  | "quantity"
  | "desired_deadline"
  | "confirmed_deadline"
>

type CustomerFields = Pick<Schedule, "customer_name" | "customer_alias">

/**
 * ガントに出す顧客名。通称（`customers.alias`）→ 正式名称 → 顧客不明の順（注文一覧の
 * `getCustomerDisplayName()` と同じ規則、Issue #589）
 */
export function scheduleCustomerLabel(schedule: CustomerFields): string {
  return schedule.customer_alias?.trim() || schedule.customer_name || UNKNOWN_CUSTOMER_LABEL
}

/** 詳細シートの顧客。正式名称に、通称が違えば併記する（ラベルの通称からどの客かを確かめられるように） */
export function scheduleCustomerFullLabel(schedule: CustomerFields): string {
  if (!schedule.customer_name) return UNKNOWN_CUSTOMER_LABEL
  const alias = schedule.customer_alias?.trim()
  return alias && alias !== schedule.customer_name ? `${schedule.customer_name}（${alias}）` : schedule.customer_name
}

/** 数量（`1,200個`）。無ければ null */
export function scheduleQuantityLabel(schedule: Pick<Schedule, "quantity">): string | null {
  return schedule.quantity != null ? `${schedule.quantity.toLocaleString("ja-JP")}個` : null
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

/** 注文行のサマリーバーのツールチップ（数量・納期・注文番号）。値の無い項目は出さない */
export function scheduleOrderMeta(schedule: OrderFields): string[] {
  return [scheduleQuantityLabel(schedule), scheduleDeadlineLabel(schedule), scheduleOrderNumberLabel(schedule)].filter(
    (part): part is string => part !== null,
  )
}

/**
 * 最後の工程の計画終了（`orderEnd`）が希望納期の日を超えているか。完成見込みは計画の終了から算出した値なので、
 * 超過の判定は希望納期があるときだけ行う（Issue #580）。ガントの納期マーカーと詳細シートで共有する
 */
export function isDeadlineExceeded(
  schedule: Pick<Schedule, "desired_deadline">,
  orderEnd: Date,
): boolean {
  if (!schedule.desired_deadline) return false
  // 日付のみの値は parseISO でローカル深夜として読む（new Date だと UTC 深夜になり日付がずれる）
  return orderEnd.getTime() >= addDays(parseISO(schedule.desired_deadline.slice(0, 10)), 1).getTime()
}

/** 注文を表す1行（顧客名・製品名）。工程行・ツールチップで使う */
export function scheduleOrderTitle(schedule: CustomerFields & Pick<Schedule, "product_name">): string {
  return [scheduleCustomerLabel(schedule), schedule.product_name].filter(Boolean).join(" ")
}
