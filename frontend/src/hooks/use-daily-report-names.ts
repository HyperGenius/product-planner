"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiClient } from "@/lib/api-client"
import { PRODUCTS_QUERY_KEY } from "@/hooks/use-products"
import type {
  IgnoredName,
  NameAliasByKind,
  NameAliasCreateByKind,
  NameEntry,
  CustomerOpenOrder,
  NameKind,
  OrderedProductCandidate,
  ProductCandidate,
  UnmatchedName,
} from "@/types/daily-report-names"

/**
 * 日報の名寄せ（未照合キュー・別名辞書・対象外）のフック (Issue #488 / #489)。
 *
 * 照合結果は明細に保存せず都度解決されるので、別名・対象外を変えたら
 * `DAILY_REPORT_NAMES_QUERY_KEY` 配下（未照合一覧・登録済みの一覧）をまとめて無効化する。
 * 製品の類似候補は別名・対象外で変わらないので配下に置かない（`PRODUCT_CANDIDATES_QUERY_KEY`）。
 */
export const DAILY_REPORT_NAMES_QUERY_KEY = ["daily-report-names"]

const BASE = "/daily-reports"

/** 照合できなかった表記の一覧（全種別。出現件数の多い順） */
export function useUnmatchedNames() {
  return useQuery<UnmatchedName[]>({
    queryKey: [...DAILY_REPORT_NAMES_QUERY_KEY, "unmatched"],
    queryFn: () => apiClient<UnmatchedName[]>(`${BASE}/unmatched-names`),
  })
}

/** 表記が使われている日報の明細。`item` が null の間は取得しない */
export function useNameEntries(
  item: Pick<UnmatchedName, "kind" | "raw_text" | "customer_raw"> | null,
) {
  return useQuery<NameEntry[]>({
    queryKey: [
      ...DAILY_REPORT_NAMES_QUERY_KEY,
      "entries",
      item?.kind,
      item?.raw_text,
      item?.customer_raw ?? null,
    ],
    queryFn: () => {
      const params = new URLSearchParams({
        kind: item!.kind,
        raw_text: item!.raw_text,
      })
      // 製品は (顧客先, 商品名) の組で絞る。顧客先が空欄なら省略（＝ NULL の行）
      if (item!.kind === "product" && item!.customer_raw !== null) {
        params.set("customer_raw", item!.customer_raw)
      }
      return apiClient<NameEntry[]>(`${BASE}/name-entries?${params}`)
    },
    enabled: item !== null,
  })
}

/**
 * 製品の類似候補のクエリキー。`DAILY_REPORT_NAMES_QUERY_KEY` の配下に置かない:
 * 候補は商品名と製品マスタだけで決まり別名・対象外の登録では変わらないので、登録のたびの
 * 無効化で未照合の製品の行数分の類似検索（pg_trgm）を再実行させないため（PR #498 Copilotレビュー）
 */
export const PRODUCT_CANDIDATES_QUERY_KEY = ["daily-report-product-candidates"]

/** 候補の鮮度。製品マスタの変更が数分遅れて反映される程度は許容し、タブの切り替えで再検索しない */
const PRODUCT_CANDIDATES_STALE_TIME_MS = 5 * 60 * 1000

/**
 * 日報の商品名に似た製品の候補（pg_trgm、全製品）。提示専用。
 * 製品のピッカーの「似ている製品」に出す。行ごとの検索になるので、ピッカーを開いたときだけ取得する（Issue #704）
 */
export function useProductCandidates(rawText: string, customerId?: number, enabled = true) {
  return useQuery<ProductCandidate[]>({
    queryKey: [...PRODUCT_CANDIDATES_QUERY_KEY, rawText, customerId ?? null],
    queryFn: () => {
      const params = new URLSearchParams({ raw_text: rawText })
      // 顧客を渡すと候補ごとに受注の有無が付く (Issue #646)
      if (customerId !== undefined) params.set("customer_id", String(customerId))
      return apiClient<ProductCandidate[]>(`${BASE}/product-candidates?${params}`)
    },
    enabled,
    staleTime: PRODUCT_CANDIDATES_STALE_TIME_MS,
  })
}

/**
 * 顧客の未出荷の受注 (Issue #646)。製品の確認ダイアログで使う（顧客単位で1リクエスト、
 * 同じ顧客の行はキャッシュを共有）。別名の登録では変わらないので `DAILY_REPORT_NAMES_QUERY_KEY` の
 * 配下に置かない（PR #498）。受注の承認などで変わるため短めに古くする。
 */
export const CUSTOMER_OPEN_ORDERS_QUERY_KEY = ["daily-report-customer-open-orders"]

export function useCustomerOpenOrders(customerId: number | null, enabled = true) {
  return useQuery<CustomerOpenOrder[]>({
    queryKey: [...CUSTOMER_OPEN_ORDERS_QUERY_KEY, customerId],
    queryFn: () =>
      apiClient<CustomerOpenOrder[]>(
        `${BASE}/customer-open-orders?${new URLSearchParams({ customer_id: String(customerId) })}`,
      ),
    enabled: enabled && customerId !== null,
    staleTime: 60 * 1000,
  })
}

/**
 * 顧客の受注のうち、日報の実績がまだ結び付いていない受注の製品 (Issue #704)。名寄せの製品の行で最初に選ぶ候補。
 * 顧客単位で1リクエストにして同じ顧客の行で共有し、日報の品名に近い順の並べ替えは行ごとに画面側で行う
 * （`rankOrderedProducts()`）。別名の登録では変わらない（実績は次の集計で付く）ので
 * `DAILY_REPORT_NAMES_QUERY_KEY` の配下に置かない（PR #498）
 */
export const CUSTOMER_ORDERED_PRODUCTS_QUERY_KEY = ["daily-report-ordered-products"]

export function useCustomerOrderedProducts(customerId: number | null) {
  return useQuery<OrderedProductCandidate[]>({
    queryKey: [...CUSTOMER_ORDERED_PRODUCTS_QUERY_KEY, customerId],
    queryFn: () =>
      apiClient<OrderedProductCandidate[]>(
        `${BASE}/customer-ordered-products?${new URLSearchParams({ customer_id: String(customerId) })}`,
      ),
    enabled: customerId !== null,
    staleTime: 60 * 1000,
  })
}

/** マスタの工程名の一覧（工程の別名の対応付け先） */
export function useMasterProcessNames() {
  return useQuery<string[]>({
    queryKey: [...DAILY_REPORT_NAMES_QUERY_KEY, "process-names"],
    queryFn: () => apiClient<string[]>(`${BASE}/process-names`),
  })
}

/** 登録済みの別名の一覧 */
export function useNameAliases<K extends NameKind>(kind: K) {
  return useQuery<NameAliasByKind[K][]>({
    queryKey: [...DAILY_REPORT_NAMES_QUERY_KEY, "aliases", kind],
    queryFn: () => apiClient<NameAliasByKind[K][]>(`${BASE}/name-aliases/${kind}`),
  })
}

/** 「対象外」にした表記の一覧 */
export function useIgnoredNames() {
  return useQuery<IgnoredName[]>({
    queryKey: [...DAILY_REPORT_NAMES_QUERY_KEY, "ignored"],
    queryFn: () => apiClient<IgnoredName[]>(`${BASE}/ignored-names`),
  })
}

function useInvalidateNames(alsoProducts = false) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: DAILY_REPORT_NAMES_QUERY_KEY })
    // 製品の別名は製品マスタの別名履歴にも出る
    if (alsoProducts) queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY })
  }
}

type NameAliasCreateVariables = {
  [K in NameKind]: { kind: K; data: NameAliasCreateByKind[K] }
}[NameKind]

/** 別名を登録する（製品は顧客単位の product_name_aliases に登録される） */
export function useCreateNameAlias() {
  const invalidate = useInvalidateNames(true)
  return useMutation({
    mutationFn: ({ kind, data }: NameAliasCreateVariables) =>
      apiClient(`${BASE}/name-aliases/${kind}`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: invalidate,
  })
}

/**
 * 名寄せの製品の行で作ったばかりの製品に、日報の品名（顧客先との組）を結び付ける (Issue #705)。
 * 製品が増えたので、成否によらず似ている製品の候補（`PRODUCT_CANDIDATES_QUERY_KEY`）も取り直す
 * （結び付けに失敗した行で「他の製品から選択」を開いたときに、作った製品が候補に出るように）。
 * `["products"]` と日報のキーを両方無効化するが、`use-products.ts` には置かない（循環 import になる）
 */
export function useLinkNameToNewProduct() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateNames(true)
  return useMutation({
    mutationFn: (data: NameAliasCreateByKind["product"]) =>
      apiClient(`${BASE}/name-aliases/product`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: invalidate,
    onSettled: () => queryClient.invalidateQueries({ queryKey: PRODUCT_CANDIDATES_QUERY_KEY }),
  })
}

type NameAliasUpdateVariables =
  | { kind: "equipment"; id: string; data: { equipment_id: number } }
  | { kind: "process"; id: string; data: { process_names: string[] } }
  | { kind: "customer"; id: string; data: { customer_id: number } }
  | {
      kind: "product"
      id: string
      /** 付け替え「元」の製品（製品マスタの別名 API の URL に使う） */
      productId: number
      data: { product_id: number }
    }

/**
 * 別名の対応先を変更する。製品の別名は製品マスタの別名 API
 * （`PATCH /products/{product_id}/aliases/{alias_id}`、監査履歴が残る）で付け替える。
 */
export function useUpdateNameAlias() {
  const invalidate = useInvalidateNames(true)
  return useMutation({
    mutationFn: (variables: NameAliasUpdateVariables) => {
      const path =
        variables.kind === "product"
          ? `/products/${variables.productId}/aliases/${variables.id}`
          : `${BASE}/name-aliases/${variables.kind}/${variables.id}`
      return apiClient(path, { method: "PATCH", body: JSON.stringify(variables.data) })
    },
    onSuccess: invalidate,
  })
}

type NameAliasDeleteVariables =
  | { kind: "equipment" | "process" | "customer"; id: string }
  | { kind: "product"; id: string; productId: number }

/** 別名を削除する。削除した表記は照合できなければ未照合キューに戻る */
export function useDeleteNameAlias() {
  const invalidate = useInvalidateNames(true)
  return useMutation({
    mutationFn: (variables: NameAliasDeleteVariables) => {
      const path =
        variables.kind === "product"
          ? `/products/${variables.productId}/aliases/${variables.id}`
          : `${BASE}/name-aliases/${variables.kind}/${variables.id}`
      return apiClient(path, { method: "DELETE" })
    },
    onSuccess: invalidate,
  })
}

/** 表記を「対象外」にして未照合キューに出さないようにする */
export function useIgnoreName() {
  const invalidate = useInvalidateNames()
  return useMutation({
    mutationFn: (item: Pick<UnmatchedName, "kind" | "raw_text" | "customer_raw">) =>
      apiClient<IgnoredName>(`${BASE}/ignored-names`, {
        method: "POST",
        body: JSON.stringify({
          kind: item.kind,
          raw_text: item.raw_text,
          customer_raw: item.kind === "product" ? item.customer_raw : null,
        }),
      }),
    onSuccess: invalidate,
  })
}

/** 「対象外」を解除する（照合できていなければ未照合キューに戻る） */
export function useUnignoreName() {
  const invalidate = useInvalidateNames()
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`${BASE}/ignored-names/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  })
}
