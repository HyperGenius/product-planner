"use client"

import { useRouter } from "next/navigation"
import { ArrowRight, BellRing } from "lucide-react"

interface PendingApprovalBannerProps {
  pendingApprovalCount: number
  ordersLoading: boolean
}

/**
 * 承認待ちの注文がある場合に表示するバナー。
 *
 * メール確認依頼の「後回しにされる」問題を再発させないため、ログイン直後に目立つ形で表示する。
 * 現行 `app/page.tsx` では president 限定だったが、表示制御は呼び出し側（PresidentDashboard）に委ねる。
 * `ordersLoading` 中・件数0のときは何も描画しない（現行踏襲）。
 */
export function PendingApprovalBanner({
  pendingApprovalCount,
  ordersLoading,
}: PendingApprovalBannerProps) {
  const router = useRouter()

  if (ordersLoading || pendingApprovalCount <= 0) return null

  return (
    <button
      type="button"
      onClick={() => router.push("/orders?status=pending_approval")}
      className="mb-8 flex w-full items-center justify-between gap-4 rounded-lg border border-red-300 bg-red-50 px-6 py-4 text-left shadow-sm transition-colors hover:bg-red-100"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-full bg-red-100 p-2.5">
          <BellRing className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <p className="font-semibold text-red-800">
            承認待ちの注文が{pendingApprovalCount}件あります
          </p>
          <p className="text-sm text-red-600">確認して承認をお願いします</p>
        </div>
      </div>
      <ArrowRight className="h-5 w-5 shrink-0 text-red-600" />
    </button>
  )
}
