"use client"

import { useState } from "react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { useExtractionPromptHistory } from "@/hooks/use-customer-extraction-prompt"
import { useTenantMembers } from "@/hooks/use-tenant-members"
import { cn } from "@/lib/utils"
import type { ExtractionPromptHistoryItem } from "@/types/customer-extraction-prompt"

interface ExtractionPromptHistoryProps {
  customerId: number
  /** 「この版を編集欄に読み込む」。null は指示なしの版 */
  onLoad: (prompt: string | null) => void
}

/** 抽出指示の変更履歴。版を選ぶと中身を表示し、編集欄に読み込める（保存は編集欄から行う） */
export function ExtractionPromptHistory({ customerId, onLoad }: ExtractionPromptHistoryProps) {
  const { data: history, isLoading, error } = useExtractionPromptHistory(customerId)
  const { data: members } = useTenantMembers()
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const changerName = (item: ExtractionPromptHistoryItem): string => {
    if (item.changed_by == null) return "画面以外で入った値"
    const member = members?.find((m) => m.user_id === item.changed_by)
    return member?.full_name || member?.email || "不明なユーザー"
  }

  const selected = history?.find((item) => item.id === selectedId) ?? null

  return (
    <section aria-labelledby="extraction-prompt-history-title" className="space-y-3">
      <h2 id="extraction-prompt-history-title" className="text-lg font-semibold">
        変更履歴
      </h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : error ? (
        <p className="text-sm text-red-500">履歴を取得できませんでした</p>
      ) : !history || history.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ変更はありません</p>
      ) : (
        <ul className="max-h-[320px] divide-y overflow-y-auto rounded-md border">
          {history.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                aria-pressed={item.id === selectedId}
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "w-full px-3 py-2 text-left text-sm hover:bg-accent",
                  item.id === selectedId && "bg-accent",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{format(new Date(item.changed_at), "yyyy/MM/dd HH:mm")}</span>
                  {index === 0 && <span className="text-xs text-muted-foreground">現在</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {changerName(item)}
                  {item.prompt == null && "・指示なし"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">
            {format(new Date(selected.changed_at), "yyyy/MM/dd HH:mm")} の版
          </p>
          <pre className="max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">
            {selected.prompt ?? "（指示なし。汎用プロンプトのみで抽出）"}
          </pre>
          <Button size="sm" variant="outline" onClick={() => onLoad(selected.prompt)}>
            この版を編集欄に読み込む
          </Button>
        </div>
      )}
    </section>
  )
}
