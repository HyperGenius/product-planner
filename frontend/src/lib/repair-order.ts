import { ApiError } from "@/lib/api-client"
import { jstTodayIso } from "@/lib/order-utils"

/** 修理注文（修理・メンテナンス・洗浄など、Issue #493 / #494）の入力値 */
export interface RepairOrderFormValues {
  orderNo: string
  customerId: string
  workDescription: string
  desiredDeadline: string
  /** 実施開始日 */
  schedulingStartDate: string
  /** 完了予定日 */
  simulatedDeadline: string
}

export const EMPTY_REPAIR_ORDER_FORM: RepairOrderFormValues = {
  orderNo: "",
  customerId: "",
  workDescription: "",
  desiredDeadline: "",
  schedulingStartDate: "",
  simulatedDeadline: "",
}

/**
 * 入力値の検証。問題があればトーストに出す文言、なければ null。
 * バックエンドの 422（`repair_dates_out_of_order` 等）と同じ条件を送信前に確かめる。
 * 過去日の実施開始日は president / platform_admin のみ設定できる（Issue #372）。
 * 編集で実施開始日を変えていないとき（`startDateChanged` が false）は、保存済みの過去日で
 * 他の項目を直せるよう過去日を検証しない
 */
export function validateRepairOrderForm(
  values: RepairOrderFormValues,
  canBackdate: boolean,
  startDateChanged: boolean = true
): string | null {
  if (!values.workDescription.trim()) return "件名・作業内容を入力してください"
  const { schedulingStartDate, simulatedDeadline } = values
  if (startDateChanged && schedulingStartDate && !canBackdate && schedulingStartDate < jstTodayIso()) {
    return "実施開始日を過去日に設定できるのは president / platform_admin のみです"
  }
  if (schedulingStartDate && simulatedDeadline && simulatedDeadline < schedulingStartDate) {
    return "完了予定日は実施開始日以降にしてください"
  }
  return null
}

const REPAIR_ERROR_MESSAGES: Record<string, string> = {
  repair_dates_missing: "実施開始日と完了予定日を入力してください",
  repair_dates_out_of_order: "完了予定日は実施開始日以降にしてください",
  invalid_simulated_deadline: "完了予定日の形式が正しくありません",
  repair_order_product_not_allowed: "修理等の注文には製品・数量を指定できません",
  duplicate_repair_order: "同じ顧客・注文番号の修理等の注文がすでに登録されています",
}

/**
 * 修理注文の API エラーを利用者向けの文言にする。`detail` は外部入力なので `errorCode` を
 * 既知の値と照合するだけで、サーバーの文言はそのまま出さない。該当しなければ null
 */
export function getRepairOrderErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  const code = error.errorCode
  return code !== undefined && code in REPAIR_ERROR_MESSAGES ? REPAIR_ERROR_MESSAGES[code] : null
}
