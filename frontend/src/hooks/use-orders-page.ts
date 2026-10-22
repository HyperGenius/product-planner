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
  isNoRoutingOrder,
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
// タブに出す値に加え、通知カード導線からのみ渡される派生フィルタ `incomplete`
// （タブ非表示、order-utils.ts 参照）も許容し、それ以外は「すべて」（""）にクランプする。
const VALID_STATUS_FILTERS = new Set<string>([
  ...STATUS_TABS.map((tab) => tab.value),
  "incomplete",
])

function toValidStatusFilter(raw: string | null): StatusFilter {
  if (raw === null) return "action_required"
  return VALID_STATUS_FILTERS.has(raw) ? (raw as StatusFilter) : ""
}

/**
 * 注文一覧の URL の状態（`?status=` / `?sort=` / `?page=` / `?customer=` / `?product=`）・絞り込み・ページング。
 * 行操作は `useOrderActions()`、一括操作は `useOrderBulkActions()` に分けている（Issue #554）
 */
export function useOrdersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // `?status=` が無い初回表示は「対応が必要」をデフォルトにする（Issue #460）。
  // 明示的に `?status=` を指定した遷移・ブックマークはその値をそのまま尊重するが、
  // 未知の値は「すべて」にクランプする（toValidStatusFilter 参照）。
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
  const isPresident = currentUserRole === "president"
  const canShipOverdueDrafts =
    currentUserRole === "president" || currentUserRole === "platform_admin"

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    // status は「対応が必要」がデフォルト（Issue #460）になったため、「すべて」(value="")
    // を選んだ操作は param 自体を削除せず `?status=` を明示的に残す。削除すると
    // 「?status= 無し」と区別が付かず、リロード時に「対応が必要」へ戻ってしまう。
    if (value || key === "status") {
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

  // 「未確定」通知カード用。「下書き」タブ（filterOrder）と揃え、シミュレーション済
  // (is_scheduled) は除外する。シミュ済は専用タブ「シミュ済」で確認する。
  const draftCount = useMemo(
    () => orders?.filter((o) => o.status === "draft" && !o.is_scheduled).length ?? 0,
    [orders]
  )
  const incompleteCount = useMemo(
    () => orders?.filter((o) => !o.customer_id || !o.desired_deadline).length ?? 0,
    [orders]
  )
  const noCustomerCount = useMemo(
    () => orders?.filter((o) => !o.customer_id).length ?? 0,
    [orders]
  )
  const noDeadlineCount = useMemo(
    () => orders?.filter((o) => !o.desired_deadline).length ?? 0,
    [orders]
  )
  // 製品はマッチ済みだが工程が無く起票できない下書き（Issue #406）。専用タブは設けず、
  // 一覧行のバッジと通知カードで次アクション（製品マスタへの工程登録）に気付けるようにする。
  const noRoutingCount = useMemo(
    () => orders?.filter((o) => isNoRoutingOrder(o)).length ?? 0,
    [orders]
  )
  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders
      .filter((order) => filterOrder(order, statusFilter, currentUserRole))
      .filter((order) => matchesCustomerProductFilter(order, customerFilterId, productFilterId))
      .sort((a, b) => compareOrders(a, b, sortKey))
  }, [orders, statusFilter, sortKey, currentUserRole, customerFilterId, productFilterId])

  const pagedOrders = useMemo(() => {
    const offset = (page - 1) * PAGE_SIZE
    return filteredOrders.slice(offset, offset + PAGE_SIZE)
  }, [filteredOrders, page])

  // 一括選択はページ・絞り込みを切り替えたら解除する（useOrderBulkActions の selectionResetKey）
  const selectionResetKey = [page, statusFilter, customerFilterId, productFilterId].join("|")

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
    selectionResetKey,
    // Data
    orders,
    products,
    customers,
    isLoading: ordersLoading || productsLoading || customersLoading,
    // Derived
    draftCount,
    incompleteCount,
    noCustomerCount,
    noDeadlineCount,
    noRoutingCount,
    filteredOrders,
    pagedOrders,
    // Role
    currentUserRole,
    isPresident,
    canShipOverdueDrafts,
  }
}
