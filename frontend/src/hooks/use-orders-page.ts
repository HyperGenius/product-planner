"use client"

import { useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useOrders } from "@/hooks/use-orders"
import { useCurrentMember } from "@/hooks/use-tenant-members"
import { useProducts } from "@/hooks/use-products"
import { useCustomers } from "@/hooks/use-customers"
import {
  filterOrder,
  compareOrders,
  matchesCustomerProductFilter,
  toValidMasterId,
  DEFAULT_SORT,
  STATUS_TABS,
  type StatusFilter,
  type SortKey,
} from "@/lib/order-utils"

const PAGE_SIZE = 20

export { PAGE_SIZE }

// `?status=` はユーザー入力（直接遷移・ブックマーク）なので、未知の値をそのまま
// `as StatusFilter` すると「一致する注文なし」の誤表示やタブの選択状態不整合になる。
// タブに出す値以外は「すべて」（""）にクランプする。廃止したタブ（Issue #558）のうち
// 「シミュ済」は「下書き」に含めたので下書きへ、「対応が必要」・「情報不足」は「すべて」へ寄せる
const VALID_STATUS_FILTERS = new Set<string>(STATUS_TABS.map((tab) => tab.value))

export function toValidStatusFilter(raw: string | null): StatusFilter {
  if (raw === "simulated") return "draft"
  return raw !== null && VALID_STATUS_FILTERS.has(raw) ? (raw as StatusFilter) : ""
}

/**
 * 「すべての注文」の URL の状態（`?status=` / `?sort=` / `?page=` / `?customer=` / `?product=`）・絞り込み・ページング。
 * 作業の入口は「起票の確認」「承認」「送品の消し込み」の各画面に移したので、ここには一括操作を持たない（Issue #558）
 */
export function useOrdersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // `?status=` が無いときは「すべて」（Issue #558）。未知の値もクランプする（toValidStatusFilter 参照）
  const statusFilter = toValidStatusFilter(searchParams.get("status"))
  const sortKey = (searchParams.get("sort") ?? DEFAULT_SORT) as SortKey
  const page = Number(searchParams.get("page") ?? "1")

  const { data: orders, isLoading: ordersLoading } = useOrders()
  const { data: products, isLoading: productsLoading } = useProducts()
  const { data: customers, isLoading: customersLoading } = useCustomers()
  const { data: currentMember } = useCurrentMember()
  // `?customer=` / `?product=`（Issue #546）。無効な値・存在しない ID は未指定にクランプする
  const customerIdSet = useMemo(
    () => (customers ? new Set(customers.map((c) => c.id)) : undefined),
    [customers]
  )
  const productIdSet = useMemo(
    () => (products ? new Set(products.map((p) => p.id)) : undefined),
    [products]
  )
  const customerFilterId = toValidMasterId(searchParams.get("customer"), customerIdSet)
  const productFilterId = toValidMasterId(searchParams.get("product"), productIdSet)
  const currentUserRole = currentMember?.role ?? null

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    if (key !== "page") params.delete("page")
    router.push(`?${params.toString()}`)
  }

  // 顧客・製品の絞り込みを一度に解除する。setParam を続けて呼ぶと2回目が古い searchParams を
  // 元にして1回目の変更を巻き戻すので、1回の router.push にまとめる（Issue #546）
  const clearMasterFilters = () => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("customer")
    params.delete("product")
    params.delete("page")
    router.push(`?${params.toString()}`)
  }

  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders
      .filter((order) => filterOrder(order, statusFilter))
      .filter((order) => matchesCustomerProductFilter(order, customerFilterId, productFilterId))
      .sort((a, b) => compareOrders(a, b, sortKey))
  }, [orders, statusFilter, sortKey, customerFilterId, productFilterId])

  const pagedOrders = useMemo(() => {
    const offset = (page - 1) * PAGE_SIZE
    return filteredOrders.slice(offset, offset + PAGE_SIZE)
  }, [filteredOrders, page])

  return {
    // URL state
    statusFilter,
    customerFilterId,
    productFilterId,
    sortKey,
    page,
    setParam,
    clearMasterFilters,
    router,
    // Data
    orders,
    products,
    customers,
    isLoading: ordersLoading || productsLoading || customersLoading,
    // Derived
    filteredOrders,
    pagedOrders,
    // Role
    currentUserRole,
  }
}
