"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import type { CustomerContact, CustomerContactCreate } from "@/types/customer"

const customerContactsKey = (customerId: number) => ["customer-contacts", customerId]

/**
 * 顧客の担当者一覧を取得するフック（Issue #611）
 *
 * `customerId` が null の間は取得しない（詳細ダイアログを開くまで問い合わせない）
 */
export function useCustomerContacts(customerId: number | null) {
  return useQuery<CustomerContact[]>({
    queryKey: customerContactsKey(customerId ?? -1),
    queryFn: () => apiClient<CustomerContact[]>(`/customers/${customerId}/contacts`),
    enabled: customerId != null,
  })
}

/**
 * 担当者を追加するフック。別の顧客に登録済みのアドレスは 409 `duplicate_contact_email`
 */
export function useCreateCustomerContact(customerId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CustomerContactCreate) =>
      apiClient<CustomerContact>(`/customers/${customerId}/contacts`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerContactsKey(customerId) })
    },
  })
}

/**
 * 担当者を削除するフック。主たる担当者（顧客の email）を消すと顧客の email も空になるので、
 * 顧客一覧も無効化する
 */
export function useDeleteCustomerContact(customerId: number) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (contactId: string) =>
      apiClient(`/customers/${customerId}/contacts/${contactId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: customerContactsKey(customerId) })
      queryClient.invalidateQueries({ queryKey: ["customers"] })
    },
  })
}
