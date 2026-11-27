"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  DAILY_REPORT_HUB_HREF,
  dailyReportHrefFromLegacyCoverageHash,
} from "@/lib/daily-report-worklist-utils"

/**
 * 旧「日報の名寄せ」（`/master/daily-report-names`）・「日報の照合状況」（`/master/daily-report-coverage`）を
 * 開いたときに、日報の実績のハブまたは対応するページへ移す（Issue #707）。ブックマーク・他の画面からの古いリンクのため。
 *
 * ハッシュはハイドレーションの後でないと読めない（`useLocationHash()` は最初にサーバーの値 "" を返し、
 * 先にハブへ移ってしまう）ので、エフェクトの中で `window.location.hash` を読む
 */
export function LegacyDailyReportRedirect({ from }: { from: "names" | "coverage" }) {
  const router = useRouter()
  useEffect(() => {
    const href =
      from === "coverage"
        ? dailyReportHrefFromLegacyCoverageHash(window.location.hash)
        : DAILY_REPORT_HUB_HREF
    router.replace(href)
  }, [from, router])
  return null
}
