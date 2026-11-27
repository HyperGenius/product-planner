import { LegacyDailyReportRedirect } from "@/components/daily-reports/legacy-redirect"

/**
 * 旧「日報の照合状況」（Issue #542 / #639）。カードのハッシュ（`#unallocated` 等）に対応するページ、
 * 無ければ日報の実績のハブへ移す（Issue #707）
 */
export default function DailyReportCoveragePage() {
  return <LegacyDailyReportRedirect from="coverage" />
}
