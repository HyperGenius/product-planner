import { format, parseISO } from "date-fns"
import { ApiError } from "@/lib/api-client"
import type { UnmatchedName } from "@/types/daily-report-names"

/** 日報の表記の一覧の1行のキー（製品は顧客先との組で1行） */
export function unmatchedNameKey(
  item: Pick<UnmatchedName, "kind" | "raw_text" | "customer_raw">,
): string {
  return JSON.stringify([item.kind, item.raw_text, item.customer_raw])
}

/** 日付のみの文字列（"YYYY-MM-DD"）を表示用に整形する。TZ でずれないよう parseISO を使う */
export function formatWorkDate(value: string | null): string {
  return value ? format(parseISO(value), "yyyy/MM/dd") : "－"
}

/** 別名・対象外の登録/変更/削除に失敗したときのトースト文言 */
export function nameMutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.errorCode === "duplicate_alias") {
      return "この表記は既に対応付けてあります（「登録済みの対応付け」で変更できます）"
    }
    if (error.errorCode === "duplicate_ignored_name") return "この表記は既に対象外です"
    if (error.status === 403) {
      return "この操作は受注担当・社長・プラットフォーム管理者のみ行えます"
    }
    // 422（マスタに無い工程名・設備が見つからない等）は固定の日本語文言が detail に入る
    if (error.status === 422 && typeof error.data.detail === "string") {
      return error.data.detail
    }
  }
  return fallback
}
