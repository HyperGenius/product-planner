"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type {
  Product,
  ProductCreate,
  ProductNameAliasHistoryEntry,
  ProductUpdate,
} from "@/types/product"

// クエリキーを定数化
export const PRODUCTS_QUERY_KEY = ["products"]

/**
 * 製品一覧を取得するフック
 */
export function useProducts() {
  return useQuery<Product[]>({
    queryKey: PRODUCTS_QUERY_KEY,
    queryFn: () => apiClient<Product[]>("/products"),
  })
}

/**
 * 製品を作成するフック
 */
export function useCreateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: ProductCreate) =>
      apiClient<Product>("/products", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 製品一覧を再取得
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY })
    },
  })
}

/**
 * 製品を更新するフック
 */
export function useUpdateProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: ProductUpdate }) =>
      apiClient<Product>(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 製品一覧を再取得
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY })
    },
  })
}

/**
 * 製品を削除するフック
 */
export function useDeleteProduct() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) =>
      apiClient(`/products/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      // 製品一覧を再取得
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY })
    },
  })
}

/**
 * 製品名の表記ゆれ修正履歴を取得するフック（Issue #347）
 */
export function useProductNameAliasHistory(productId: number | null) {
  return useQuery<ProductNameAliasHistoryEntry[]>({
    queryKey: ["products", productId, "aliases"],
    queryFn: () =>
      apiClient<ProductNameAliasHistoryEntry[]>(`/products/${productId}/aliases`),
    enabled: productId !== null,
  })
}

/**
 * 製品の有効/無効（is_active）を切り替えるフック
 */
export function useToggleProductActive() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      apiClient<Product>(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active }),
      }),
    onSuccess: () => {
      // 製品一覧を再取得
      queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY })
    },
  })
}
