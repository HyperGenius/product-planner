"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { PRODUCTS_QUERY_KEY } from "@/hooks/use-products"
import {
  DAILY_REPORT_NAMES_QUERY_KEY,
  PRODUCT_CANDIDATES_QUERY_KEY,
} from "@/hooks/use-daily-report-names"
import { DAILY_REPORT_PROGRESS_QUERY_KEY } from "@/hooks/use-daily-report-progress"
import type {
  ProductMergeCandidatesParams,
  ProductMergeCandidatesResponse,
  ProductMergeCounts,
  ProductMergePreview,
  ProductMergeRequest,
} from "@/types/product"

/**
 * 重複製品の統合（Issue #515）のフック。
 *
 * `use-daily-report-names.ts` が `use-products.ts` を import しているため、日報のクエリキーを
 * 無効化するこのフック群は循環 import にならないよう別ファイルに置く。
 */
export const PRODUCT_MERGE_QUERY_KEY = [...PRODUCTS_QUERY_KEY, "merge"]
const PREVIEW_KEY = "preview"

function isPreviewQueryKey(queryKey: readonly unknown[]): boolean {
  return PRODUCT_MERGE_QUERY_KEY.every((k, i) => queryKey[i] === k) &&
    queryKey[PRODUCT_MERGE_QUERY_KEY.length] === PREVIEW_KEY
}

/** 直径・長さ・材質が一致する統合の候補。`params` が null の間は取得しない */
export function useProductMergeCandidates(params: ProductMergeCandidatesParams | null) {
  return useQuery<ProductMergeCandidatesResponse>({
    queryKey: [...PRODUCT_MERGE_QUERY_KEY, "candidates", params],
    queryFn: () =>
      apiClient<ProductMergeCandidatesResponse>(
        `/products/merge-candidates?${new URLSearchParams({ ...params! })}`
      ),
    enabled: params !== null,
  })
}

/** 付け替え・削除の件数と統合を止める理由。統合される製品が無い間は取得しない */
export function useProductMergePreview(request: ProductMergeRequest | null) {
  const mergeIds = request ? [...request.merge_product_ids].sort((a, b) => a - b) : []
  return useQuery<ProductMergePreview>({
    queryKey: [...PRODUCT_MERGE_QUERY_KEY, PREVIEW_KEY, request?.keep_product_id ?? null, mergeIds],
    queryFn: () =>
      apiClient<ProductMergePreview>("/products/merge/preview", {
        method: "POST",
        body: JSON.stringify({
          keep_product_id: request!.keep_product_id,
          merge_product_ids: mergeIds,
        }),
      }),
    enabled: request !== null && mergeIds.length > 0,
  })
}

/**
 * 統合の実行（取り消し不可）。
 *
 * 製品一覧・表記ゆれ履歴（`["products"]` 配下）・受注・ガント・日報の進捗と名寄せを無効化する。
 * プレビューは統合済みの製品 ID で再取得すると 404 になるので無効化の対象から外す
 * （呼び出し側が選択をリセットすると使われなくなる）。
 */
export function useMergeProducts() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: ProductMergeRequest) =>
      apiClient<ProductMergeCounts>("/products/merge", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: PRODUCTS_QUERY_KEY,
        predicate: (query) => !isPreviewQueryKey(query.queryKey),
      })
      queryClient.invalidateQueries({ queryKey: ["orders"] })
      queryClient.invalidateQueries({ queryKey: ["schedules"] })
      queryClient.invalidateQueries({ queryKey: DAILY_REPORT_PROGRESS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: DAILY_REPORT_NAMES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: PRODUCT_CANDIDATES_QUERY_KEY })
    },
  })
}
