"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { DAILY_REPORT_NAME_EDITOR_ROLES } from "@/types/member"
import { IgnoredNameList } from "./ignored-name-list"
import { NameAliasList } from "./name-alias-list"
import { UnmatchedNameQueue } from "./unmatched-name-queue"

/** 作業モードのタブ（下線）。種別のカード型タブと見分ける (Issue #643) */
const MODE_TRIGGER_CLASS = "h-full flex-none rounded-none px-1 text-base group-data-[orientation=horizontal]/tabs:after:bottom-[-1px]"
/** モードの中身。一覧の領域が残りの高さを使ってスクロールする */
const MODE_CONTENT_CLASS = "flex min-h-0 flex-1 flex-col gap-2"

/**
 * 日報の名寄せ画面 (Issue #489)。
 * 日報の表記（設備・工程・顧客・製品）のうちマスタに照合できなかったものを、
 * 別名辞書への登録（対応付け）か「対象外」で片付ける。1回対応付ければ以後は自動で照合される。
 */
export function DailyReportNameMatching() {
  const { data: member } = useCurrentMember()
  // ロール取得前は読み取り専用で表示する（書き込みは API 側でもロールを確認する）
  const canEdit = member != null && DAILY_REPORT_NAME_EDITOR_ROLES.includes(member.role)

  return (
    // 高さ = 画面 − レイアウトのヘッダー(3.75rem) − 上下余白(3rem)。ページ全体はスクロールさせず、一覧の領域だけで動かす (Issue #643)
    <div className="flex h-[calc(100dvh-6.75rem)] min-w-0 flex-col gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">日報の名寄せ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          日報の設備・工程・顧客・製品の表記をマスタに対応付けます。1回対応付けると、過去・今後の日報にも自動で反映されます。
        </p>
        {member != null && !canEdit && (
          <p className="mt-2 text-sm text-muted-foreground">
            対応付けの登録・変更は受注担当・社長・プラットフォーム管理者が行えます（閲覧のみ）。
          </p>
        )}
      </div>
      <Tabs defaultValue="unmatched" className="min-h-0 flex-1">
        <TabsList variant="line" className="h-10 w-full justify-start gap-4 border-b p-0">
          <TabsTrigger value="unmatched" className={MODE_TRIGGER_CLASS}>未照合キュー</TabsTrigger>
          <TabsTrigger value="aliases" className={MODE_TRIGGER_CLASS}>登録済みの対応付け</TabsTrigger>
          <TabsTrigger value="ignored" className={MODE_TRIGGER_CLASS}>対象外</TabsTrigger>
        </TabsList>
        <TabsContent value="unmatched" className={MODE_CONTENT_CLASS}>
          <UnmatchedNameQueue canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="aliases" className={MODE_CONTENT_CLASS}>
          <NameAliasList canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="ignored" className={MODE_CONTENT_CLASS}>
          <IgnoredNameList canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
