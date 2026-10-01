"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { DAILY_REPORT_NAME_EDITOR_ROLES } from "@/types/member"
import { IgnoredNameList } from "./ignored-name-list"
import { NameAliasList } from "./name-alias-list"
import { UnmatchedNameQueue } from "./unmatched-name-queue"

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
    <div className="space-y-4 pb-10">
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
      <Tabs defaultValue="unmatched">
        <TabsList>
          <TabsTrigger value="unmatched">未照合キュー</TabsTrigger>
          <TabsTrigger value="aliases">登録済みの対応付け</TabsTrigger>
          <TabsTrigger value="ignored">対象外</TabsTrigger>
        </TabsList>
        <TabsContent value="unmatched">
          <UnmatchedNameQueue canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="aliases">
          <NameAliasList canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="ignored">
          <IgnoredNameList canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
