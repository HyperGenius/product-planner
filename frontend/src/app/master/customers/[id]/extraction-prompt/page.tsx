"use client"

import { useParams } from "next/navigation"
import { ExtractionPromptEditor } from "@/components/customer-extraction-prompt/extraction-prompt-editor"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { EXTRACTION_PROMPT_EDITOR_ROLES } from "@/types/member"

/**
 * 顧客ごとの抽出指示（取り込み設定）の編集・試し読み画面（Issue #602）
 * URL: /master/customers/[id]/extraction-prompt
 *
 * platform_admin 以外には中身を出さない（API も 403 を返す）。ロールが分かるまで
 * 編集画面を描かず、他のロールで指示・履歴の取得を走らせない
 */
export default function CustomerExtractionPromptPage() {
  const params = useParams()
  const customerId = Number(params.id)
  const { data: member, isLoading } = useCurrentMember()

  if (isLoading) return <div className="py-10 text-center">読み込み中...</div>
  if (!member || !EXTRACTION_PROMPT_EDITOR_ROLES.includes(member.role)) {
    return <div className="py-10">この画面は platform_admin のみ使えます</div>
  }
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return <div className="py-10 text-red-500">顧客が見つかりません</div>
  }
  return <ExtractionPromptEditor customerId={customerId} />
}
