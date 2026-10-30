"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  useCustomerExtractionPrompt,
  useExtractionPromptAttachments,
  usePreviewExtractionPrompt,
  useSaveExtractionPrompt,
} from "@/hooks/use-customer-extraction-prompt"
import { ApiError } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { EXTRACTION_PROMPT_MAX_LENGTH } from "@/types/customer-extraction-prompt"
import { ExtractionPreviewComparison } from "./extraction-preview-comparison"
import { ExtractionPromptHistory } from "./extraction-prompt-history"

const PROMPT_EXAMPLES = [
  "2ページ目の「庫入伝票」は注文ではないので明細に含めない",
  "注文番号は右上の「発注No.」欄の値を使う",
  "「納入指示日」を納期として読む",
]

/** 前後の空白を除き、空なら null（指示なし）。Backend の normalize_extraction_prompt と揃える */
function normalizePrompt(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/** バックエンドの固定文言（detail.message / detail）を取り出す。形が違えば fallback */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  const detail = error.data.detail
  if (typeof detail === "string") return detail
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const message = (detail as Record<string, unknown>).message
    if (typeof message === "string") return message
  }
  return fallback
}

interface ExtractionPromptEditorProps {
  customerId: number
}

/**
 * 顧客ごとの抽出指示（取り込み設定）の編集画面（Issue #602）。
 * 指示の編集 → 過去のPDFで試し読み（今の指示と並べる）→ 保存。横に変更履歴
 */
export function ExtractionPromptEditor({ customerId }: ExtractionPromptEditorProps) {
  const textareaId = useId()
  const { data: current, isLoading, error } = useCustomerExtractionPrompt(customerId)
  const { data: attachments, isLoading: attachmentsLoading } =
    useExtractionPromptAttachments(customerId)
  const saveMutation = useSaveExtractionPrompt(customerId)
  const previewMutation = usePreviewExtractionPrompt(customerId)

  // null は「未編集」（今の指示をそのまま表示する）。保存後に null へ戻して最新を表示する
  const [draft, setDraft] = useState<string | null>(null)
  const [attachmentId, setAttachmentId] = useState<string | null>(null)
  // 直近の試し読みに使った編集欄の内容（編集欄がそのあと変わったかを示すため）
  const [previewedPrompt, setPreviewedPrompt] = useState<string | null>(null)

  if (isLoading) return <div className="py-10 text-center">読み込み中...</div>
  if (error || !current) {
    return (
      <div className="py-10 text-red-500">
        {error instanceof ApiError && error.status === 404
          ? "顧客が見つかりません"
          : "抽出指示を取得できませんでした"}
      </div>
    )
  }

  const value = draft ?? current.prompt ?? ""
  const normalized = normalizePrompt(value)
  const isDirty = normalized !== current.prompt
  const length = normalized?.length ?? 0
  const isOverLimit = length > EXTRACTION_PROMPT_MAX_LENGTH
  const preview = previewMutation.data
  const isPreviewStale = preview != null && previewedPrompt !== value

  const handleSave = async () => {
    try {
      const result = await saveMutation.mutateAsync(normalized)
      toast.success(result.changed ? "抽出指示を保存しました" : "変更はありません")
      setDraft(null)
    } catch (e) {
      toast.error(apiErrorMessage(e, "抽出指示の保存に失敗しました"))
    }
  }

  const handlePreview = () => {
    if (!attachmentId) return
    setPreviewedPrompt(value)
    previewMutation.mutate(
      { attachment_id: attachmentId, prompt: normalized },
      {
        onError: (e) => toast.error(apiErrorMessage(e, "試し読みに失敗しました")),
      },
    )
  }

  return (
    <div className="py-6">
      <div className="mb-6">
        <Link
          href="/master/customers"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          顧客マスタへ戻る
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">
          取り込み設定: {current.customer_name}
        </h1>
        <p className="text-muted-foreground">
          この顧客の注文書（PDF・メール本文）を読み取るときに、汎用の指示へ足す指示です。
          過去に届いたPDFで試し読みして、今の指示との違いを確かめてから保存してください。
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          <section className="space-y-2">
            <Label htmlFor={textareaId} className="text-lg font-semibold">
              抽出指示
            </Label>
            <textarea
              id={textareaId}
              rows={8}
              value={value}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="指示なし（汎用の指示だけで読み取ります）"
              aria-invalid={isOverLimit || undefined}
              className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
              <div className="text-muted-foreground">
                <p>書き方の例:</p>
                <ul className="list-disc pl-5">
                  {PROMPT_EXAMPLES.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
                <p className="mt-1">空にして保存すると、汎用の指示だけで読み取ります。</p>
              </div>
              <span className={cn("tabular-nums", isOverLimit && "font-semibold text-red-600")}>
                {length} / {EXTRACTION_PROMPT_MAX_LENGTH}文字
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={!isDirty || isOverLimit || saveMutation.isPending}
              >
                {saveMutation.isPending ? "保存中..." : "保存"}
              </Button>
              {isDirty && (
                <Button variant="outline" onClick={() => setDraft(null)}>
                  編集を取り消す
                </Button>
              )}
            </div>
          </section>

          <section aria-labelledby="extraction-preview-title" className="space-y-3">
            <h2 id="extraction-preview-title" className="text-lg font-semibold">
              試し読み
            </h2>
            <p className="text-sm text-muted-foreground">
              選んだPDFを今の指示と編集中の指示の両方で読み取ります。受注の起票・通知は行いません。
            </p>
            {attachmentsLoading ? (
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            ) : !attachments || attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">この顧客の受信PDFがありません</p>
            ) : (
              <div
                role="radiogroup"
                aria-label="試し読みするPDF"
                className="max-h-[240px] divide-y overflow-y-auto rounded-md border"
              >
                {attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    type="button"
                    role="radio"
                    aria-checked={attachment.id === attachmentId}
                    onClick={() => setAttachmentId(attachment.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-4 px-3 py-2 text-left text-sm hover:bg-accent",
                      attachment.id === attachmentId && "bg-accent font-medium",
                    )}
                  >
                    <span className="truncate">{attachment.original_filename || "（名前なし）"}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {format(new Date(attachment.received_at), "yyyy/MM/dd HH:mm")} 受信
                    </span>
                  </button>
                ))}
              </div>
            )}
            <Button
              onClick={handlePreview}
              disabled={!attachmentId || isOverLimit || previewMutation.isPending}
            >
              {previewMutation.isPending ? "読み取り中..." : "試し読み"}
            </Button>

            {preview && (
              <div className="space-y-3">
                {isPreviewStale && (
                  <p className="text-sm text-amber-700">
                    試し読みのあとで編集欄が変わっています。今の内容で確かめるにはもう一度試し読みしてください。
                  </p>
                )}
                <ExtractionPreviewComparison preview={preview} />
              </div>
            )}
          </section>
        </div>

        <aside>
          <ExtractionPromptHistory
            customerId={customerId}
            onLoad={(prompt) => {
              setDraft(prompt ?? "")
              toast.info("編集欄に読み込みました。試し読みしてから保存してください")
            }}
          />
        </aside>
      </div>
    </div>
  )
}
