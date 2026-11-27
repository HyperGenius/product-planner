"use client"

import { IgnoredNameList } from "@/components/daily-report-names/ignored-name-list"
import { NameAliasList } from "@/components/daily-report-names/name-alias-list"
import { UnmatchedNameList } from "@/components/daily-report-names/unmatched-name-list"
import {
  DailyReportPageLayout,
  ListStatus,
} from "@/components/daily-reports/daily-report-page-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useCanEditDailyReportNames,
  useDailyReportWorklist,
} from "@/hooks/use-daily-report-worklist"
import { DAILY_REPORT_ALIASES_LABEL } from "@/lib/daily-report-worklist-utils"

/** 作業モードのタブ（下線）。種別のカード型タブと見分ける (Issue #643) */
const MODE_TRIGGER_CLASS =
  "h-full flex-none rounded-none px-1 text-base group-data-[orientation=horizontal]/tabs:after:bottom-[-1px]"
/** モードの中身。一覧の領域が残りの高さを使ってスクロールする */
const MODE_CONTENT_CLASS = "flex min-h-0 flex-1 flex-col gap-2"

/**
 * 日報の実績の参考: 登録済みの対応付け・対象外（Issue #489 / #707）
 * URL: /master/daily-reports/aliases
 *
 * 管理のためのページ。旧「日報の名寄せ」の「登録済みの対応付け」「対象外」タブと、
 * 結び付いていない日報の設備（割り付けに使わないのでハブに数えない。#709 で設備マスタ側へ移すまでここに置く）
 */
export default function DailyReportAliasesPage() {
  const { worklist, names, coverage, computedAt } = useDailyReportWorklist()
  const canEdit = useCanEditDailyReportNames()

  return (
    <DailyReportPageLayout
      title={DAILY_REPORT_ALIASES_LABEL}
      computedAt={computedAt}
      isCoverageError={coverage.isError}
    >
      <Tabs defaultValue="aliases" className="min-h-0 flex-1">
        <TabsList variant="line" className="h-10 w-full justify-start gap-4 border-b p-0">
          <TabsTrigger value="aliases" className={MODE_TRIGGER_CLASS}>
            登録済みの対応付け
          </TabsTrigger>
          <TabsTrigger value="ignored" className={MODE_TRIGGER_CLASS}>
            対象外
          </TabsTrigger>
          <TabsTrigger value="equipment" className={MODE_TRIGGER_CLASS}>
            日報の設備
          </TabsTrigger>
        </TabsList>
        <TabsContent value="aliases" className={MODE_CONTENT_CLASS}>
          <NameAliasList canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="ignored" className={MODE_CONTENT_CLASS}>
          <IgnoredNameList canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="equipment" className={MODE_CONTENT_CLASS}>
          {names.isLoading || names.isError ? (
            <ListStatus isLoading={names.isLoading} isError={names.isError} />
          ) : (
            <UnmatchedNameList
              items={worklist.excluded.names}
              kind="equipment"
              canEdit={canEdit}
              emptyMessage="設備マスタに無い日報の設備はありません"
            />
          )}
        </TabsContent>
      </Tabs>
    </DailyReportPageLayout>
  )
}
