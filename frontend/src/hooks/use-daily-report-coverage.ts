"use client"

import { useQuery } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type {
  DailyReportCoverage,
  UnallocatedActual,
  UnallocatedGroup,
} from "@/types/daily-report-progress"

/**
 * 日報の照合状況のフック (Issue #542)。
 *
 * 割り付け・照合状況は cron（10〜15分間隔）がテナント単位で再計算して保存するので、画面からは参照するだけ。
 * 未照合キューで別名を登録しても、ここに反映されるのは次の再計算の後。
 */
export const DAILY_REPORT_COVERAGE_QUERY_KEY = ["daily-report-coverage"]

/** まとめた1行を開いたときに出す元の日報の行の上限（新しい順） */
export const UNALLOCATED_ACTUALS_LIMIT = 100

/** 照合状況のサマリと未割当のまとめ。`months` は直近何か月（今月を含む）か。null ならすべての期間 */
export function useDailyReportCoverage(months: number | null) {
  return useQuery<DailyReportCoverage>({
    queryKey: [...DAILY_REPORT_COVERAGE_QUERY_KEY, "summary", months],
    queryFn: () => {
      const params = new URLSearchParams()
      if (months !== null) params.set("months", String(months))
      const query = params.toString()
      return apiClient<DailyReportCoverage>(
        `/daily-reports/coverage${query ? `?${query}` : ""}`,
      )
    },
  })
}

/** まとめた1行（製品・工程名・理由）の元の日報の行。`group` が null の間は取得しない */
export function useUnallocatedActuals(
  group: Pick<UnallocatedGroup, "product_id" | "process_name" | "reason"> | null,
  months: number | null,
) {
  return useQuery<UnallocatedActual[]>({
    queryKey: [
      ...DAILY_REPORT_COVERAGE_QUERY_KEY,
      "actuals",
      group?.product_id,
      group?.process_name,
      group?.reason,
      months,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        product_id: String(group!.product_id),
        process_name: group!.process_name,
        reason: group!.reason,
        limit: String(UNALLOCATED_ACTUALS_LIMIT),
      })
      if (months !== null) params.set("months", String(months))
      return apiClient<UnallocatedActual[]>(`/daily-reports/unallocated-actuals?${params}`)
    },
    enabled: group !== null,
  })
}
