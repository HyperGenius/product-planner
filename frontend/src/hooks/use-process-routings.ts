"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { ProcessRouting, ProcessRoutingCreate, ProcessRoutingUpdate } from "@/types/process-routing"

// クエリキーを生成する関数
const getProcessRoutingsQueryKey = (productId: number) => ["process-routings", productId]

/**
 * 製品の製造工程ルーティング一覧を取得するフック
 */
export function useProcessRoutings(productId: number | null) {
  return useQuery<ProcessRouting[]>({
    queryKey: getProcessRoutingsQueryKey(productId ?? 0),
    queryFn: () => apiClient<ProcessRouting[]>(`/process-routings/?product_id=${productId}`),
    enabled: productId !== null,
  })
}

/**
 * 製造工程ルーティングを作成するフック
 */
export function useCreateProcessRouting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: ProcessRoutingCreate) =>
      apiClient<ProcessRouting>("/process-routings/", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (data) => {
      // 該当製品の工程ルーティング一覧を再取得
      queryClient.invalidateQueries({ 
        queryKey: getProcessRoutingsQueryKey(data.product_id) 
      })
    },
  })
}

/**
 * 製造工程ルーティングを更新するフック
 */
export function useUpdateProcessRouting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ProcessRoutingUpdate }) =>
      apiClient<ProcessRouting>(`/process-routings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (data) => {
      // 該当製品の工程ルーティング一覧を再取得
      queryClient.invalidateQueries({ 
        queryKey: getProcessRoutingsQueryKey(data.product_id) 
      })
    },
  })
}

/**
 * 製造工程ルーティングを削除するフック
 */
export function useDeleteProcessRouting() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, productId }: { id: number; productId: number }) =>
      apiClient(`/process-routings/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_, variables) => {
      // 該当製品の工程ルーティング一覧を再取得
      queryClient.invalidateQueries({ 
        queryKey: getProcessRoutingsQueryKey(variables.productId) 
      })
    },
  })
}
