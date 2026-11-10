"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { ShipmentFileList, ShipmentFileUploadResult } from "@/types/shipment-file"

/**
 * 弥生販売の売上伝票 CSV（送品ファイル）の取り込み状況とアップロード (Issue #662)。
 * 取り込みは共有フォルダ経由（エージェント）が本線で、ここのアップロードは予備の経路。
 */
export const SHIPMENT_FILES_QUERY_KEY = ["shipment-files"]

/** 最終取り込み日時と直近のファイル */
export function useShipmentFiles() {
  return useQuery<ShipmentFileList>({
    queryKey: SHIPMENT_FILES_QUERY_KEY,
    queryFn: () => apiClient<ShipmentFileList>("/shipment-files"),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  })
}

/** CSV をそのままボディで送る（ブラウザでのハッシュ計算はせず、サーバーが求める） */
export function useUploadShipmentFile() {
  const queryClient = useQueryClient()
  return useMutation<ShipmentFileUploadResult, Error, File>({
    mutationFn: async (file) =>
      apiClient<ShipmentFileUploadResult>("/shipment-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          // 日本語のファイル名をヘッダで送るため UTF-8 でパーセントエンコードする
          "X-File-Name": encodeURIComponent(file.name),
          "X-File-Modified-At": new Date(file.lastModified).toISOString(),
        },
        // File をそのまま渡さず中身のバイト列にする（環境によって fetch が File を文字列化するのを避ける）
        body: await file.arrayBuffer(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SHIPMENT_FILES_QUERY_KEY }),
  })
}
