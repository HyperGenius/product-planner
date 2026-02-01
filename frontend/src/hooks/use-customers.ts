"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { Customer, CustomerCreate, CustomerUpdate } from "@/types/customer"

// クエリキーを定数化
const CUSTOMERS_QUERY_KEY = ["customers"]

/**
 * 顧客一覧を取得するフック
 */
export function useCustomers() {
  return useQuery<Customer[]>({
    queryKey: CUSTOMERS_QUERY_KEY,
    queryFn: () => apiClient<Customer[]>("/customers"),
  })
}

/**
 * 顧客を作成するフック
 */
export function useCreateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CustomerCreate) =>
      apiClient<Customer>("/customers", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 顧客一覧を再取得
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY })
    },
  })
}

/**
 * 顧客を更新するフック
 */
export function useUpdateCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: CustomerUpdate }) =>
      apiClient<Customer>(`/customers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // 顧客一覧を再取得
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY })
    },
  })
}

/**
 * 顧客を削除するフック
 */
export function useDeleteCustomer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) =>
      apiClient(`/customers/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      // 顧客一覧を再取得
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY })
    },
  })
}
