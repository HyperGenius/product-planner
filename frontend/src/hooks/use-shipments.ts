"use client"

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ApiError, apiClient } from "@/lib/api-client"
import type {
  ShipmentCustomerItem,
  ShipmentOrderMatchList,
  ShipmentProductItem,
} from "@/types/shipment"

/**
 * 弥生の売上明細の名寄せ・送品の突合（Issue #667）。
 *
 * 突合は参照のたびにバックエンドが求める（保存しない）ので、辞書を変えたら送品の突合も無効化する。
 * 送品の突合は名寄せの一覧と同じ `["shipments"]` の配下に置き、辞書の登録でまとめて取り直す
 * （行ごとに発火するクエリは無いので、配下に置いても登録1回あたり数リクエスト）。
 */
export const SHIPMENTS_QUERY_KEY = ["shipments"]

/** `GET /shipments/order-matches` の `order_id` の上限（Backend `_MAX_ORDER_IDS`） */
export const SHIPMENT_ORDER_MATCH_MAX_IDS = 500

const STALE_TIME_MS = 5 * 60 * 1000

/**
 * 受注ごとの弥生の送品（分納を合算）。送品の消し込みの対象の受注をまとめて引く（行ごとに引かない）。
 * 上限を超える件数は分割して並列に取得し結合する。`orderIds` が空の間は取得しない。
 *
 * @param options.keepPrevious true なら `orderIds` が変わって別キーになっても、取得し直す間は直前の結果を返す
 *   （送品の消し込みで1件送品すると対象の ID が減り、表全体が読み込み中に戻るのを防ぐ。Issue #649）
 */
export function useShipmentOrderMatches(
  orderIds: readonly number[],
  options?: { keepPrevious?: boolean },
) {
  const ids = Array.from(new Set(orderIds)).sort((a, b) => a - b)
  return useQuery<ShipmentOrderMatchList>({
    queryKey: [...SHIPMENTS_QUERY_KEY, "order-matches", ids],
    queryFn: async () => {
      const chunks: number[][] = []
      for (let i = 0; i < ids.length; i += SHIPMENT_ORDER_MATCH_MAX_IDS) {
        chunks.push(ids.slice(i, i + SHIPMENT_ORDER_MATCH_MAX_IDS))
      }
      const results = await Promise.all(
        chunks.map((chunk) => {
          const params = new URLSearchParams()
          chunk.forEach((id) => params.append("order_id", String(id)))
          return apiClient<ShipmentOrderMatchList>(`/shipments/order-matches?${params}`)
        }),
      )
      return {
        latest_sales_date: results[0]?.latest_sales_date ?? null,
        items: results.flatMap((r) => r.items),
      }
    },
    enabled: ids.length > 0,
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: false,
    placeholderData: options?.keepPrevious ? keepPreviousData : undefined,
  })
}

/** 得意先ごとの照合状況と候補（名寄せの画面） */
export function useShipmentCustomers() {
  return useQuery<ShipmentCustomerItem[]>({
    queryKey: [...SHIPMENTS_QUERY_KEY, "customers"],
    queryFn: () => apiClient<ShipmentCustomerItem[]>("/shipments/customers"),
    refetchOnWindowFocus: false,
  })
}

/** (得意先, 商品コード) ごとの照合状況と候補（名寄せの画面） */
export function useShipmentProducts() {
  return useQuery<ShipmentProductItem[]>({
    queryKey: [...SHIPMENTS_QUERY_KEY, "products"],
    queryFn: () => apiClient<ShipmentProductItem[]>("/shipments/products"),
    refetchOnWindowFocus: false,
  })
}

/** 名寄せの書き込み。成功したら一覧と送品の突合をまとめて取り直す */
function useShipmentNameMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation<unknown, Error, TVariables>({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SHIPMENTS_QUERY_KEY }),
  })
}

function sendJson(endpoint: string, method: "POST" | "PUT", body: unknown) {
  return apiClient(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** 得意先に顧客をひも付ける（商流のため1つの得意先に複数登録できる） */
export function useAddShipmentCustomerLink() {
  return useShipmentNameMutation((v: { customer_code: string; customer_id: number }) =>
    sendJson("/shipments/customer-links", "POST", v),
  )
}

export function useDeleteShipmentCustomerLink() {
  return useShipmentNameMutation((linkId: string) =>
    apiClient(`/shipments/customer-links/${linkId}`, { method: "DELETE" }),
  )
}

/**
 * (得意先, 商品コード) に製品を対応付ける。`customer_id` を渡すと、先に得意先にその顧客もひも付ける
 * （商流の推定の候補を選んだとき。既にひも付いていれば 409 を無視して続ける）
 */
export function useSetShipmentProductLink() {
  return useShipmentNameMutation(
    async (v: {
      customer_code: string
      product_code: string
      product_id: number
      customer_id?: number
    }) => {
      if (v.customer_id !== undefined) {
        try {
          await sendJson("/shipments/customer-links", "POST", {
            customer_code: v.customer_code,
            customer_id: v.customer_id,
          })
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 409)) throw error
        }
      }
      return sendJson("/shipments/product-links", "PUT", {
        customer_code: v.customer_code,
        product_code: v.product_code,
        product_id: v.product_id,
      })
    },
  )
}

export function useDeleteShipmentProductLink() {
  return useShipmentNameMutation((linkId: string) =>
    apiClient(`/shipments/product-links/${linkId}`, { method: "DELETE" }),
  )
}

export function useAddShipmentIgnored() {
  return useShipmentNameMutation(
    (v: { kind: "customer" | "product"; customer_code: string; product_code?: string }) =>
      sendJson("/shipments/ignored", "POST", v),
  )
}

export function useDeleteShipmentIgnored() {
  return useShipmentNameMutation((ignoredId: string) =>
    apiClient(`/shipments/ignored/${ignoredId}`, { method: "DELETE" }),
  )
}
