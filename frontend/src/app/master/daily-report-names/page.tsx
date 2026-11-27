import { LegacyDailyReportRedirect } from "@/components/daily-reports/legacy-redirect"

/** 旧「日報の名寄せ」（Issue #489）。日報の実績のハブへ移す（Issue #707） */
export default function DailyReportNamesPage() {
  return <LegacyDailyReportRedirect from="names" />
}
