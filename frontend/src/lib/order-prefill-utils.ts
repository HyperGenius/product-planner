import { format, isValid, parse } from "date-fns"

/**
 * 受注作成（`/orders/new`）を初期値・戻り先付きで開くクエリ（Issue #694、Epic #690）。
 *
 * 送品の消し込みの③受注を起票するから、弥生の明細の顧客・製品・数量・希望納期を入れた状態で開き、作成したら③へ戻す。
 * クエリは外部入力（URL の直接編集・ブックマーク）なので、`parseNewOrderPrefill()` で形を検証してから使い、
 * 知らない値は無視して空欄にする。戻り先は既知のパス（`NEW_ORDER_RETURN_PATHS`）だけを受け取り、任意の URL へは移らない
 */

/** 作成後に戻れる画面（パス → 戻るリンクの文言） */
export const NEW_ORDER_RETURN_PATHS = {
  "/orders/shipping/register": "③ 受注を起票する",
} as const

export type NewOrderReturnPath = keyof typeof NEW_ORDER_RETURN_PATHS

/** 戻り先が無いとき（従来どおり）の移り先 */
export const NEW_ORDER_DEFAULT_RETURN_PATH = "/orders"

export interface NewOrderPrefill {
  customerId: number | null
  productId: number | null
  quantity: number | null
  /** 希望納期（"YYYY-MM-DD"） */
  desiredDeadline: string | null
  returnTo: NewOrderReturnPath | null
}

/** クエリの名前（`buildNewOrderHref()` と `parseNewOrderPrefill()` で共有） */
const PARAM = {
  customerId: "customer_id",
  productId: "product_id",
  quantity: "quantity",
  desiredDeadline: "desired_deadline",
  returnTo: "return_to",
} as const

/** 数量・ID の上限（Postgres の integer に収まる値） */
const MAX_INT = 2_147_483_647

/** 1以上の整数の文字列だけを数値にする（"01"・"1.5"・"1e3"・空白付きは受け取らない） */
export function toPositiveInt(value: string | null | undefined): number | null {
  if (!value || !/^[1-9]\d{0,9}$/.test(value)) return null
  const n = Number(value)
  return n <= MAX_INT ? n : null
}

/** 実在する日付の "YYYY-MM-DD" だけを受け取る（"2026-02-30" は受け取らない） */
export function toValidIsoDate(value: string | null | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = parse(value, "yyyy-MM-dd", new Date())
  return isValid(date) && format(date, "yyyy-MM-dd") === value ? value : null
}

/** 既知の戻り先だけを受け取る */
export function toValidReturnPath(value: string | null | undefined): NewOrderReturnPath | null {
  if (!value) return null
  return Object.prototype.hasOwnProperty.call(NEW_ORDER_RETURN_PATHS, value)
    ? (value as NewOrderReturnPath)
    : null
}

/** `useSearchParams()` の値から初期値と戻り先を取り出す。形の合わない値は null（空欄） */
export function parseNewOrderPrefill(
  params: Pick<URLSearchParams, "get"> | null | undefined,
): NewOrderPrefill {
  const get = (name: string) => params?.get(name) ?? null
  return {
    customerId: toPositiveInt(get(PARAM.customerId)),
    productId: toPositiveInt(get(PARAM.productId)),
    quantity: toPositiveInt(get(PARAM.quantity)),
    desiredDeadline: toValidIsoDate(get(PARAM.desiredDeadline)),
    returnTo: toValidReturnPath(get(PARAM.returnTo)),
  }
}

/** 初期値・戻り先付きの受注作成の URL。null・不正な値はクエリに載せない */
export function buildNewOrderHref(prefill: Partial<NewOrderPrefill>): string {
  const params = new URLSearchParams()
  const setInt = (name: string, value: number | null | undefined) => {
    if (value != null && toPositiveInt(String(value)) !== null) params.set(name, String(value))
  }
  setInt(PARAM.customerId, prefill.customerId)
  setInt(PARAM.productId, prefill.productId)
  setInt(PARAM.quantity, prefill.quantity)
  const deadline = toValidIsoDate(prefill.desiredDeadline)
  if (deadline) params.set(PARAM.desiredDeadline, deadline)
  const returnTo = toValidReturnPath(prefill.returnTo)
  if (returnTo) params.set(PARAM.returnTo, returnTo)
  const query = params.toString()
  return query ? `/orders/new?${query}` : "/orders/new"
}
