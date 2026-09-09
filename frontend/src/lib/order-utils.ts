import type { Order } from "@/types/order"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

export type StatusFilter =
  | ""
  | "draft"
  | "simulated"
  | "pending_approval"
  | "confirmed"
  | "in_progress"
  | "shipped"
  | "completed"
  | "canceled"
export type SortKey = "created_at_desc" | "created_at_asc" | "desired_deadline_asc"

export const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "すべて", value: "" },
  { label: "下書き", value: "draft" },
  { label: "シミュ済", value: "simulated" },
  { label: "承認待ち", value: "pending_approval" },
  { label: "確定済", value: "confirmed" },
  { label: "生産中", value: "in_progress" },
  { label: "送品済み", value: "shipped" },
  { label: "完了", value: "completed" },
  { label: "キャンセル", value: "canceled" },
]

export const DEFAULT_SORT: SortKey = "desired_deadline_asc"

export const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "登録日（新しい順）", value: "created_at_desc" },
  { label: "登録日（古い順）", value: "created_at_asc" },
  { label: "希望納期（近い順）", value: "desired_deadline_asc" },
]

/**
 * 「製品はマッチ済みだが工程（process_routings）が1件も無いため起票（シミュレーション／承認）
 * できない」下書き受注か（Issue #406）。バックエンドの `has_no_routings` 集約をそのまま使う。
 *
 * 受注詳細ページ（`orders/[id]/page.tsx` の `hasNoRouting`）と判定を揃える:
 *  - `product_id` 未マッチの受注も `has_no_routings` が true になるが、それは「製品未確定」
 *    バッジ側で扱うため除外する（バッジの二重表示を防ぐ）
 *  - すでに `is_scheduled`／確定以降のステータスは「過去に工程があった」等でノイズになるため対象外
 *    （＝未シミュレーションの draft のみを対象にする）
 *
 * フィルタータブは追加しない（`orders.status` のみに限定する設計方針 #215）。
 * この状態は一覧行のバッジ・通知カードで認知させる。
 */
export function isNoRoutingOrder(order: Order): boolean {
  return (
    order.has_no_routings === true &&
    order.product_id !== null &&
    order.status === "draft" &&
    !order.is_scheduled
  )
}

export function filterOrder(order: Order, statusFilter: StatusFilter): boolean {
  if (!statusFilter) return true
  // 「シミュ済」= status='draft' かつ is_scheduled（シミュレーション完了・未確定）。
  // 「下書き」タブは未シミュレーションの下書きのみに絞り、両タブを排他にする。
  // Issue #394-A 以降、is_scheduled はスケジュール条件の編集で simulated_deadline とともに
  // クリアされるため、`is_scheduled` と `simulated_deadline != null` は draft では実質同値
  // （表示値は simulated_deadline を使う。getDeadlineForTab / usesSimulatedDeadline 参照）。
  if (statusFilter === "simulated") {
    return order.status === "draft" && !!order.is_scheduled
  }
  if (statusFilter === "draft") {
    return order.status === "draft" && !order.is_scheduled
  }
  return order.status === statusFilter
}

/**
 * 日付のみを表す文字列 (例: "2026-10-01" や "2026-10-01T00:00:00")
 * をタイムゾーンの影響を受けずに "yyyy/MM/dd" 表示へ整形する。
 * `new Date()` でパースすると環境のタイムゾーンによって日付がずれるため使用しない。
 */
export function formatDeadlineDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  return dateStr.slice(0, 10).replace(/-/g, "/")
}

/**
 * 納期日付を一覧向けに短縮表示する（Issue #397）。
 * 当年（JST基準）は "M/D"、それ以外の年は "YY/M/D"。
 * 日付として解釈できない文字列は `formatDeadlineDate` の結果にフォールバックする。
 */
export function formatDeadlineShort(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  const iso = dateStr.slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return formatDeadlineDate(dateStr)
  const [, year, month, day] = m
  const mm = String(Number(month))
  const dd = String(Number(day))
  const currentYear = jstTodayIso().slice(0, 4)
  return year === currentYear ? `${mm}/${dd}` : `${year.slice(2)}/${mm}/${dd}`
}

/**
 * 日付のみを表す文字列を `<input type="date">` が要求する "YYYY-MM-DD" 形式に整形する。
 */
export function toDateInputValue(dateStr: string | null | undefined): string {
  if (!dateStr) return ""
  return dateStr.slice(0, 10)
}

/**
 * ローカルタイムの「今日」を "YYYY-MM-DD" 形式で返す。
 * `toISOString()` は UTC 変換で日付がずれるため使わない。
 */
export function localTodayIso(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

/**
 * Asia/Tokyo タイムゾーンの「今日」を "YYYY-MM-DD" 形式で返す。
 * 作業開始日 (scheduling_start_date) の過去日判定はバックエンドが
 * `datetime.now(JST).date()` 基準のため、フロント側もJSTに揃える（Issue #372）。
 * `en-CA` ロケールは常に "YYYY-MM-DD" 形式で出力する。
 */
export function jstTodayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })
}

/**
 * "YYYY-MM-DD" 形式かつ実在する日付か検証する。
 * バックエンドの `date.fromisoformat` 相当のチェックで、`2026-13-40` のような
 * 不正な文字列を弾く（文字列比較だけだと不正日付が「納期超過」と誤判定されるため）。
 */
export function isValidIsoDate(dateStr: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!m) return false
  const [, y, mo, d] = m
  const dt = new Date(`${dateStr}T00:00:00Z`)
  return (
    dt.getUTCFullYear() === Number(y) &&
    dt.getUTCMonth() + 1 === Number(mo) &&
    dt.getUTCDate() === Number(d)
  )
}

/**
 * 納期を過ぎたまま残っている下書き受注か判定する（Issue #367）。
 * 「status === 'draft' かつ 希望納期が有効な日付として設定済み かつ 希望納期 < 今日」。
 * 不正な日付文字列はバックエンドと同様に対象外（false）とする。
 */
export function isOverdueDraft(order: Order, todayIso: string = localTodayIso()): boolean {
  if (order.status !== "draft") return false
  if (!order.desired_deadline) return false
  const deadline = order.desired_deadline.slice(0, 10)
  if (!isValidIsoDate(deadline)) return false
  return deadline < todayIso
}

/**
 * 「確定納期」を出す（＝確定以降の）ステータス。これ以外は「シミュ納期」を出す（Issue #394）。
 * `confirmed_deadline` は承認確定時にしか書き込まれないため、承認前は常に空になる。
 * そのフェーズの関心事（＝シミュレーション上いつ完成するか）に合わせてカラムを出し分ける。
 */
const CONFIRMED_DEADLINE_STATUSES: readonly Order["status"][] = [
  "confirmed",
  "in_progress",
  "shipped",
  "completed",
]

/** 一覧タブ（StatusFilter）が「シミュ納期」を表示すべきか。false なら「確定納期」。 */
export function usesSimulatedDeadline(statusFilter: StatusFilter): boolean {
  // 「すべて」(="") は確定納期。下書き / シミュ済 / 承認待ち / キャンセルはシミュ納期。
  if (!statusFilter) return false
  return !(CONFIRMED_DEADLINE_STATUSES as string[]).includes(statusFilter)
}

/** 受注単体（タブ文脈なし。受注詳細・承認モーダル）で「シミュ納期」を表示すべきか。 */
export function usesSimulatedDeadlineForOrder(order: Order): boolean {
  return !CONFIRMED_DEADLINE_STATUSES.includes(order.status)
}

/** 一覧カラムのヘッダ文言。 */
export function getDeadlineColumnLabel(statusFilter: StatusFilter): string {
  return usesSimulatedDeadline(statusFilter) ? "シミュ納期" : "確定納期"
}

/** そのタブで表示すべき納期値（未設定なら null）。 */
export function getDeadlineForTab(order: Order, statusFilter: StatusFilter): string | null {
  const raw = usesSimulatedDeadline(statusFilter)
    ? order.simulated_deadline
    : order.confirmed_deadline
  return raw ?? null
}

/**
 * 表示中の納期（シミュ納期 or 確定納期）が希望納期より後（遅延）か。
 * どちらかが未設定、または不正な日付文字列なら false（強調しない）。
 */
export function isDeadlineOverdue(
  order: Order,
  deadline: string | null | undefined
): boolean {
  if (!deadline || !order.desired_deadline) return false
  const actual = deadline.slice(0, 10)
  const desired = order.desired_deadline.slice(0, 10)
  if (!isValidIsoDate(actual) || !isValidIsoDate(desired)) return false
  return actual > desired
}

export function compareOrders(a: Order, b: Order, sortKey: SortKey): number {
  if (sortKey === "created_at_desc" || sortKey === "created_at_asc") {
    if (!a.created_at && !b.created_at) return 0
    if (!a.created_at) return 1
    if (!b.created_at) return -1
    const timeA = new Date(a.created_at).getTime()
    const timeB = new Date(b.created_at).getTime()
    return sortKey === "created_at_desc" ? timeB - timeA : timeA - timeB
  }
  if (!a.desired_deadline && !b.desired_deadline) return 0
  if (!a.desired_deadline) return 1
  if (!b.desired_deadline) return -1
  return a.desired_deadline.localeCompare(b.desired_deadline)
}

/**
 * 図番（code）と品名（name）を「1行目＝図番／2行目＝品名」の2段表示用に分解する。
 * 未移行データ（`code` が NULL で `name` に図番が入っている行）は name を1行目へ繰り上げ、
 * 2行目は null にする。製品マスタ一覧（`master/products` の `resolveProductDisplay`）と
 * 表示ヒューリスティックを共通化する（全テナントの図番が揃ったら撤去予定）。
 */
export function splitProductCodeName(
  code: string | null | undefined,
  name: string
): { primary: string; secondary: string | null } {
  return {
    primary: code || name,
    secondary: code ? name : null,
  }
}

/**
 * 製品IDから製品名を取得。productIdがnull（自動起票時に製品未マッチ）の場合は、
 * 抽出済みの生テキスト（extractedProductName）があればそれをフォールバック表示する。
 */
export function getProductName(
  productId: number | null,
  products?: Product[],
  extractedProductName?: string | null
): string {
  if (productId == null) {
    return extractedProductName ? `${extractedProductName}（製品未確定）` : "不明"
  }
  const product = products?.find((p) => p.id === productId)
  if (!product) return "不明"
  const { primary, secondary } = splitProductCodeName(product.code, product.name)
  return secondary ? `${primary} - ${secondary}` : primary
}

export interface ProductDisplayParts {
  /** 1行目に出す文字列（図番。未移行データ・製品未確定時は品名／生テキスト） */
  primary: string
  /** 2行目に出す品名。1行目に品名を繰り上げた場合や未設定なら null */
  secondary: string | null
  /** 製品マスタと未突合（product_id が null／マスタに存在しない） */
  unresolved: boolean
}

/**
 * 注文一覧の製品セルを「図番／品名」の2行で表示するための分解済みデータを返す（Issue #397）。
 * productId が null（自動起票で製品未マッチ）の場合は extractedProductName をフォールバック表示する。
 */
export function getProductDisplayParts(
  productId: number | null,
  products?: Product[],
  extractedProductName?: string | null
): ProductDisplayParts {
  if (productId == null) {
    return {
      primary: extractedProductName ? `${extractedProductName}（製品未確定）` : "不明",
      secondary: null,
      unresolved: true,
    }
  }
  const product = products?.find((p) => p.id === productId)
  if (!product) {
    return { primary: "不明", secondary: null, unresolved: true }
  }
  const { primary, secondary } = splitProductCodeName(product.code, product.name)
  return { primary, secondary, unresolved: false }
}

/**
 * 顧客IDから顧客名を取得
 */
export function getCustomerName(customerId: number | undefined, customers?: Customer[]): string {
  if (!customerId) return "-"
  const customer = customers?.find((c) => c.id === customerId)
  return customer ? customer.name : "不明"
}

/**
 * 顧客IDから「通称（alias）」を優先して表示名を取得する（Issue #397）。
 * alias 未設定なら正式名（name）にフォールバックする。注文一覧の「通称」カラム用。
 */
export function getCustomerDisplayName(
  customerId: number | undefined,
  customers?: Customer[]
): string {
  if (!customerId) return "-"
  const customer = customers?.find((c) => c.id === customerId)
  if (!customer) return "不明"
  return customer.alias?.trim() || customer.name
}

/**
 * 表示用の実効ステータス。
 * `orders.status` の値そのものではなく、「シミュレーション完了・未確定」
 * (status='draft' かつ is_scheduled) を `simulated` として区別するための
 * フロントエンド専用の派生値。DB スキーマ・API・`Order["status"]` 型は変更しない。
 */
export type EffectiveOrderStatus = Order["status"] | "simulated"

/**
 * 注文の実効ステータスを算出する。
 * status='draft' かつ is_scheduled（`POST /orders/{id}/simulate` 成功後に立つ）なら
 * `simulated`。それ以外は元の status をそのまま返す。
 */
export function getEffectiveOrderStatus(order: Order): EffectiveOrderStatus {
  if (order.status === "draft" && order.is_scheduled) return "simulated"
  return order.status
}

/**
 * ステータスの日本語ラベルを取得
 */
export function getStatusLabel(status: EffectiveOrderStatus): string {
  const statusLabels: Record<EffectiveOrderStatus, string> = {
    draft: "下書き",
    simulated: "シミュ済",
    pending_approval: "承認待ち",
    confirmed: "確定",
    in_progress: "生産中",
    shipped: "送品済み",
    completed: "完了",
    canceled: "キャンセル",
  }
  return statusLabels[status] || status
}

/**
 * ステータスバッジの Tailwind クラスを取得
 */
export function getStatusBadgeClass(status: EffectiveOrderStatus): string {
  const classes: Record<EffectiveOrderStatus, string> = {
    draft:             "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
    simulated:         "bg-indigo-100 text-indigo-800 hover:bg-indigo-100",
    pending_approval:  "bg-orange-100 text-orange-800 hover:bg-orange-100",
    confirmed:         "bg-green-100 text-green-800 hover:bg-green-100",
    in_progress:       "bg-sky-100 text-sky-800 hover:bg-sky-100",
    shipped:           "bg-teal-100 text-teal-800 hover:bg-teal-100",
    completed:         "bg-blue-100 text-blue-800 hover:bg-blue-100",
    canceled:          "bg-gray-100 text-gray-500 hover:bg-gray-100",
  }
  return classes[status] ?? ""
}

/**
 * 顧客側の確度（PDF/メール文面から抽出した内示・内々示・確定の別）の日本語ラベルを取得。
 * ProductPlanner側のワークフローステータス(status)とは独立した参考情報。
 */
export function getCertaintyLabel(certainty: NonNullable<Order["customer_certainty"]>): string {
  const certaintyLabels: Record<NonNullable<Order["customer_certainty"]>, string> = {
    confirmed: "顧客確定",
    forecast: "内示",
    forecast_tentative: "内々示",
  }
  return certaintyLabels[certainty] || certainty
}

/**
 * 顧客側の確度バッジの Tailwind クラスを取得
 */
export function getCertaintyBadgeClass(
  certainty: NonNullable<Order["customer_certainty"]>
): string {
  const classes: Record<NonNullable<Order["customer_certainty"]>, string> = {
    confirmed:           "bg-green-50 text-green-700 hover:bg-green-50",
    forecast:            "bg-orange-100 text-orange-800 hover:bg-orange-100",
    forecast_tentative:  "bg-purple-100 text-purple-800 hover:bg-purple-100",
  }
  return classes[certainty] ?? ""
}

/**
 * source_raw 中の最初に見つかった「件名: ...」行(先頭とは限らない)を件名として
 * 切り出し、その行より後ろを本文として返す。件名行が見つからない場合は全体を
 * 本文として扱う。
 */
export function splitSubjectAndBody(sourceRaw?: string | null): {
  subject?: string
  body?: string
} {
  if (!sourceRaw) return {}
  const match = sourceRaw.match(/^件名[:：]\s*(.*)$/m)
  if (!match || match.index == null) return { body: sourceRaw }
  const subject = match[1].trim()
  const body = sourceRaw.slice(match.index + match[0].length).replace(/^\s+/, "")
  return { subject: subject || undefined, body: body || undefined }
}
