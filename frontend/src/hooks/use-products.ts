"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { Product, ProductCreate, ProductUpdate } from "@/types/product"

// クエリキーを定数化
const PRODUCTS_QUERY_KEY = ["products"]

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
