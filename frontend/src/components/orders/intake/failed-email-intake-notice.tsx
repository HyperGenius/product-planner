"use client"

import Link from "next/link"
import { Inbox, XCircle } from "lucide-react"
import { useEmailIntakeResults } from "@/hooks/use-orders"
import {
  countRecentFailedEmailIntakes,
  RECENT_FAILED_EMAIL_INTAKE_DAYS,
} from "@/lib/order-utils"

/**
 * 起票に失敗した受信メールへの導線（Issue #555）。失敗には「対応済み」の状態が無いので、
 * 直近 `RECENT_FAILED_EMAIL_INTAKE_DAYS` 日に受信したものだけを数える。0件・取得前でもリンクは置く
 */
export function FailedEmailIntakeNotice() {
  const { data: results } = useEmailIntakeResults()
  const failedCount = results ? countRecentFailedEmailIntakes(results) : 0

  if (failedCount === 0) {
    return (
      <div className="mb-4 flex justify-end">
        <Link
          href="/orders/email-intake"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          <Inbox className="h-4 w-4" />
          受信メール処理結果を見る
        </Link>
      </div>
    )
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
    >
      <p className="flex items-center gap-2 text-sm">
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        直近{RECENT_FAILED_EMAIL_INTAKE_DAYS}日に受信したメールのうち
        <span className="font-semibold text-destructive">{failedCount}件</span>
        が起票に失敗しています。内容を確認して手動で起票してください。
      </p>
      <Link
        href="/orders/email-intake"
        className="text-sm font-medium text-destructive hover:underline"
      >
        受信メール処理結果を見る →
      </Link>
    </div>
  )
}
