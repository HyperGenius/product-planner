"use client"

import { ListPageLayout } from "@/components/layout/list-page-layout"
import { DailyReportHelp } from "@/components/daily-reports/daily-report-help"
import {
  DailyReportPrerequisiteBanner,
  DailyReportReference,
  DailyReportWorkQueue,
} from "@/components/daily-reports/daily-report-hub"
import { DailyReportFreshness } from "@/components/daily-reports/daily-report-page-layout"
import { useDailyReportWorklist } from "@/hooks/use-daily-report-worklist"
import { DAILY_REPORT_HUB_TITLE } from "@/lib/daily-report-worklist-utils"

/**
 * 日報の実績（仮称、Issue #707、Epic #701）
 * URL: /master/daily-reports
 *
 * 旧「日報の名寄せ」（#489）と「日報の照合状況」（#542 / #639）を、次に何をするかの順に並べた1つのハブ。
 * 件数は `classifyDailyReportWorklist()` の結果から出し、各作業の一覧は専用のページ（`/master/daily-reports/<page>`）に置く。
 * ページの行も同じ結果から出すので件数と一致する。
 *
 * - 前提バナー: アプリに未登録の日報の顧客先・顧客先が決まっていない日報の製品があるときだけ出す
 * - ① 日報の製品をつなぐ（products）・② 製品の工程を日報に合わせる（processes）・③ 受注の無い製造を確かめる（unordered）
 * - 参考: 作り置き（stock）・結び付いた割合・登録済みの対応付け・対象外（aliases）
 *
 * 画面の文言は docs/ui-writing-guidelines.md に従う。仕組み・判定条件・抽出条件は `DailyReportHelp`（見出しの横の「?」）に書く
 */
export default function DailyReportHubPage() {
  const { counts, coverage, computedAt } = useDailyReportWorklist()
  const summary =
    coverage.data && coverage.data.computed_at !== null ? coverage.data.summary : null

  return (
    <ListPageLayout title={DAILY_REPORT_HUB_TITLE} help={<DailyReportHelp />}>
      <DailyReportFreshness computedAt={computedAt} isError={coverage.isError} />
      <DailyReportPrerequisiteBanner counts={counts} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-4">
        <DailyReportWorkQueue counts={counts} />
        <DailyReportReference counts={counts} summary={summary} />
      </div>
    </ListPageLayout>
  )
}
