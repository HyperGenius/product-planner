import { format, parseISO } from "date-fns"
import { ApiError } from "@/lib/api-client"
import type { UnmatchedName } from "@/types/daily-report-names"

/** 日報の表記の一覧の1行のキー（製品は顧客先との組で1行） */
export function unmatchedNameKey(
  item: Pick<UnmatchedName, "kind" | "raw_text" | "customer_raw">,
): string {
  return JSON.stringify([item.kind, item.raw_text, item.customer_raw])
}

/** 日付のみの文字列（"YYYY-MM-DD"）を表示用に整形する。TZ でずれないよう parseISO を使う */
export function formatWorkDate(value: string | null): string {
  return value ? format(parseISO(value), "yyyy/MM/dd") : "－"
}

/** 別名・対象外の登録/変更/削除に失敗したときのトースト文言 */
export function nameMutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.errorCode === "duplicate_alias") {
      return "この表記は既に対応付けてあります（「登録済みの対応付け」で変更できます）"
    }
    if (error.errorCode === "duplicate_ignored_name") return "この表記は既に対象外です"
    if (error.status === 403) {
      return "この操作は受注担当・社長・プラットフォーム管理者のみ行えます"
    }
    // 422（マスタに無い工程名・設備が見つからない等）は固定の日本語文言が detail に入る
    if (error.status === 422 && typeof error.data.detail === "string") {
      return error.data.detail
    }
  }
  return fallback
}

/**
 * 顧客先が決まっていない日報の製品のまとまり（Issue #703）。
 * - unregistered: アプリに未登録の顧客先。顧客を選ぶと、その下の製品を①で結び付けられるようになる
 * - ignored: 顧客先を対象外にした（未登録の顧客先の一覧に出ない）。製品は対象外にだけできる
 * - blank: 顧客先が空欄。顧客を選べないので、製品は対象外にだけできる
 */
export type CustomerRawGroup =
  | {
      type: "unregistered"
      customerRaw: string
      /** 未登録の顧客先の表記（顧客の別名の登録先） */
      customer: UnmatchedName
      products: UnmatchedName[]
    }
  | { type: "ignored"; customerRaw: string; products: UnmatchedName[] }
  | { type: "blank"; customerRaw: null; products: UnmatchedName[] }

export interface CustomerRawGroups {
  /** 未登録の顧客先ごとのまとまり（顧客先の一覧の順＝明細の多い順）。製品が無い顧客先も出す */
  unregistered: Extract<CustomerRawGroup, { type: "unregistered" }>[]
  /** 顧客を選べないまとまり（対象外にした顧客先 → 空欄の順） */
  unresolved: Extract<CustomerRawGroup, { type: "ignored" | "blank" }>[]
}

/**
 * 顧客先が決まっていない日報の製品を、顧客先の表記ごとにまとめる（Issue #703）。
 * 顧客先の見出しに1回だけ出し、行ごとに同じ文章を並べないため。製品の並びは受け取った順（明細の多い順）のまま
 */
export function groupProductsByCustomerRaw(
  customers: readonly UnmatchedName[],
  products: readonly UnmatchedName[],
): CustomerRawGroups {
  const unregistered = new Map<string, CustomerRawGroups["unregistered"][number]>()
  for (const customer of customers) {
    if (unregistered.has(customer.raw_text)) continue
    unregistered.set(customer.raw_text, {
      type: "unregistered",
      customerRaw: customer.raw_text,
      customer,
      products: [],
    })
  }
  const ignored = new Map<string, Extract<CustomerRawGroup, { type: "ignored" }>>()
  const blank: Extract<CustomerRawGroup, { type: "blank" }> = {
    type: "blank",
    customerRaw: null,
    products: [],
  }
  for (const product of products) {
    if (product.customer_raw === null) {
      blank.products.push(product)
      continue
    }
    const group = unregistered.get(product.customer_raw)
    if (group) {
      group.products.push(product)
      continue
    }
    // 顧客先の表記が未登録の一覧に無い＝対象外にした顧客先
    const ignoredGroup = ignored.get(product.customer_raw) ?? {
      type: "ignored" as const,
      customerRaw: product.customer_raw,
      products: [],
    }
    ignoredGroup.products.push(product)
    ignored.set(product.customer_raw, ignoredGroup)
  }
  return {
    unregistered: [...unregistered.values()],
    unresolved: [...ignored.values(), ...(blank.products.length > 0 ? [blank] : [])],
  }
}
