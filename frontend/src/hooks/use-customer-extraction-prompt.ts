"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type {
  ExtractionPreview,
  ExtractionPreviewRequest,
  ExtractionPrompt,
  ExtractionPromptAttachment,
  ExtractionPromptHistoryItem,
  ExtractionPromptSaveResult,
} from "@/types/customer-extraction-prompt"

/** 顧客ごとの抽出指示（Issue #602）のクエリキー。保存で配下をまとめて無効化する */
export const extractionPromptQueryKey = (customerId: number) =>
  ["customer-extraction-prompt", customerId] as const

const basePath = (customerId: number) => `/customers/${customerId}/extraction-prompt`

/** 顧客の今の抽出指示（platform_admin のみ） */
export function useCustomerExtractionPrompt(customerId: number) {
  return useQuery<ExtractionPrompt>({
    queryKey: [...extractionPromptQueryKey(customerId), "current"],
    queryFn: () => apiClient<ExtractionPrompt>(basePath(customerId)),
  })
}

/** 抽出指示の変更履歴（新しい順） */
export function useExtractionPromptHistory(customerId: number) {
  return useQuery<ExtractionPromptHistoryItem[]>({
    queryKey: [...extractionPromptQueryKey(customerId), "history"],
    queryFn: () => apiClient<ExtractionPromptHistoryItem[]>(`${basePath(customerId)}/history`),
  })
}

/** 試し読みに使える、その顧客の過去の受信PDF（新しい順） */
export function useExtractionPromptAttachments(customerId: number) {
  return useQuery<ExtractionPromptAttachment[]>({
    // 保存で変わらないので、指示・履歴の無効化の対象から外す
    queryKey: ["customer-extraction-prompt-attachments", customerId],
    queryFn: () =>
      apiClient<ExtractionPromptAttachment[]>(`${basePath(customerId)}/attachments`),
  })
}

/** 抽出指示を保存する。空文字・null は指示なし（汎用プロンプトのみ）に戻す */
export function useSaveExtractionPrompt(customerId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (prompt: string | null) =>
      apiClient<ExtractionPromptSaveResult>(basePath(customerId), {
        method: "PUT",
        body: JSON.stringify({ prompt }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: extractionPromptQueryKey(customerId) })
    },
  })
}

/**
 * 過去のPDFを今の指示と編集中の指示で読み取る。Claude API を呼ぶので結果はキャッシュしない
 * （useMutation。押したときだけ実行する）
 */
export function usePreviewExtractionPrompt(customerId: number) {
  return useMutation({
    mutationFn: (request: ExtractionPreviewRequest) =>
      apiClient<ExtractionPreview>(`${basePath(customerId)}/preview`, {
        method: "POST",
        body: JSON.stringify(request),
      }),
  })
}
