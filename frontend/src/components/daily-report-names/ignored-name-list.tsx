"use client"

import { Undo2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useIgnoredNames, useUnignoreName } from "@/hooks/use-daily-report-names"
import { nameMutationErrorMessage } from "@/lib/daily-report-name-utils"
import { NAME_KIND_LABELS } from "@/types/daily-report-names"

/** 「対象外」にした表記の一覧。戻すと（照合できていなければ）未照合キューに再び出る (Issue #489) */
export function IgnoredNameList({ canEdit }: { canEdit: boolean }) {
  const { data: ignored, isLoading, isError } = useIgnoredNames()
  const unignore = useUnignoreName()

  if (isLoading) return <p className="py-6 text-sm text-muted-foreground">読み込み中...</p>
  if (isError || !ignored) {
    return <p className="py-6 text-sm text-destructive">対象外の表記を取得できませんでした</p>
  }
  if (ignored.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        対象外にした表記はありません
      </p>
    )
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {ignored.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
          <Badge variant="outline">{NAME_KIND_LABELS[item.kind]}</Badge>
          <span className="break-all font-medium">{item.raw_text}</span>
          {item.kind === "product" && (
            <span className="text-xs text-muted-foreground">
              顧客先: {item.customer_raw ?? "（空欄）"}
            </span>
          )}
          {canEdit && (
            <Button
              className="ml-auto"
              variant="ghost"
              size="sm"
              disabled={unignore.isPending}
              aria-label={`「${item.raw_text}」を未照合キューに戻す`}
              onClick={() =>
                unignore.mutate(item.id, {
                  onSuccess: () => toast.success(`「${item.raw_text}」を対象外から戻しました`),
                  onError: (error) =>
                    toast.error(nameMutationErrorMessage(error, "対象外から戻せませんでした")),
                })
              }
            >
              <Undo2 />
              戻す
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
