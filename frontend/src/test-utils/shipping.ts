/**
 * 送品の消し込みのハブ・各ページ（Issue #692 / #693）のテストで共有するフィクスチャと MSW のハンドラ。
 * 値はすべてダミー（docs: 実データを公開物に書かない）
 */
import { http, HttpResponse } from "msw"
import { screen } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { ProcessProgress } from "@/types/daily-report-progress"
import type { MemberRole } from "@/types/member"
import type { Order } from "@/types/order"
import type {
  ShipmentEntryRef,
  ShipmentOrderMatch,
  ShipmentOrderReview,
  ShipmentUnmatchedGroup,
  ShipmentUnmatchedList,
} from "@/types/shipment"

export const PAST = "2000-01-10"
export const FUTURE = "2099-12-31"

export function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 1,
    order_no: "O-1",
    product_id: 1,
    customer_id: 1,
    quantity: 10,
    desired_deadline: FUTURE,
    confirmed_deadline: FUTURE,
    status: "confirmed",
    customer_certainty: null,
    is_scheduled: true,
    source_type: "manual",
    tenant_id: "t1",
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

export function makeProcess(overrides: Partial<ProcessProgress>): ProcessProgress {
  return {
    order_id: 1,
    process_routing_id: 1,
    sequence_order: 1,
    process_name: "プレス",
    good_qty: 0,
    order_quantity: 10,
    first_actual_date: null,
    last_actual_date: null,
    status: "not_started",
    completed_by: null,
    planned_end_datetime: null,
    ...overrides,
  }
}

export function mockOrders(orders: Order[]): void {
  server.use(http.get(`${API_BASE}/orders`, () => HttpResponse.json(orders)))
}

/** 進捗を返し、リクエストされた order_id を記録する */
export function mockProgress(items: ProcessProgress[], computedAt: string | null = "2099-10-01T01:05:00Z") {
  const requested: number[][] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/order-progress`, ({ request }) => {
      const ids = new URL(request.url).searchParams.getAll("order_id").map(Number)
      requested.push(ids)
      return HttpResponse.json({
        computed_at: computedAt,
        items: items.filter((p) => ids.includes(p.order_id)),
      })
    }),
  )
  return requested
}

export function mockRole(role: MemberRole): void {
  server.use(
    http.get(`${API_BASE}/tenant/members/me`, () =>
      HttpResponse.json({ user_id: "u-1", email: "member@example.com", full_name: "テスト", role }),
    ),
  )
}

/** 見出し行を除いた行（表示順） */
export function getBodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1)
}

export function getRow(orderNo: string): HTMLElement {
  const row = screen.getByRole("link", { name: orderNo }).closest("tr")
  if (!row) throw new Error(`row not found: ${orderNo}`)
  return row
}

export function makeEntry(id: number, quantity: number, candidates: number[] = []): ShipmentEntryRef {
  return {
    id,
    sales_date: "2026-10-15",
    slip_no: "1",
    quantity,
    note: null,
    product_name: "品A",
    method: candidates.length ? null : "deadline",
    candidate_order_ids: candidates,
  }
}

export function makeMatch(overrides: Partial<ShipmentOrderMatch>): ShipmentOrderMatch {
  return {
    order_id: 1,
    shipped_qty: 10,
    order_quantity: 10,
    is_fully_shipped: true,
    last_sales_date: "2026-10-15",
    entries: [makeEntry(1, 10)],
    ambiguous_entries: [],
    ...overrides,
  }
}

/** 弥生の送品を返す。`latestSalesDate` は取り込んだ明細の最新の売上日（②の取り込み待ちの判定に使う） */
export function mockMatches(items: ShipmentOrderMatch[], latestSalesDate = "2026-10-15"): void {
  server.use(
    http.get(`${API_BASE}/shipments/order-matches`, ({ request }) => {
      const ids = new URL(request.url).searchParams.getAll("order_id").map(Number)
      return HttpResponse.json({
        latest_sales_date: latestSalesDate,
        items: items.filter((m) => ids.includes(m.order_id)),
      })
    }),
  )
}

export function makeUnmatched(overrides: Partial<ShipmentUnmatchedGroup>): ShipmentUnmatchedGroup {
  return {
    status: "no_order",
    customer_code: "001",
    customer_code_key: "001",
    customer_name: "架空工業(株)",
    product_code: "X1",
    product_code_key: "X1",
    product_name: "品A",
    latest_note: null,
    entry_count: 1,
    total_qty: 10,
    last_sales_date: "2026-10-10",
    customer_ids: [],
    product_ids: [],
    note_deadlines: [],
    candidate_order_ids: [],
    ...overrides,
  }
}

export function mockUnmatched(items: ShipmentUnmatchedGroup[], extra?: Partial<ShipmentUnmatchedList>) {
  const counts = { unmatched_customer: 0, unmatched_product: 0, no_order: 0, ambiguous: 0 }
  for (const item of items) counts[item.status] += 1
  server.use(
    http.get(`${API_BASE}/shipments/unmatched-entries`, () =>
      HttpResponse.json({
        latest_sales_date: "2026-10-14",
        since: "2026-08-16",
        counts,
        truncated: false,
        items,
        ...extra,
      } satisfies ShipmentUnmatchedList),
    ),
  )
}

export function makeReview(overrides: Partial<ShipmentOrderReview>): ShipmentOrderReview {
  return {
    order_id: 1,
    product_id: 101,
    cause: "missing_report",
    shipped_qty: 100,
    last_sales_date: "2026-10-10",
    final_process_name: "プレス",
    final_good_qty: 0,
    unallocated_qty: 0,
    process_names: [],
    ...overrides,
  }
}

export function mockOrderReviews(items: ShipmentOrderReview[]) {
  const counts = { no_routing: 0, process_mismatch: 0, customer_or_stock: 0, missing_report: 0 }
  for (const item of items) counts[item.cause] += 1
  server.use(
    http.get(`${API_BASE}/shipments/order-reviews`, () =>
      HttpResponse.json({ computed_at: "2099-10-01T01:05:00Z", counts, items }),
    ),
  )
}

export function mockMasters(): void {
  server.use(
    http.get(`${API_BASE}/customers`, () =>
      HttpResponse.json([{ id: 1, name: "架空工業株式会社", alias: "架空" }]),
    ),
    http.get(`${API_BASE}/products`, () =>
      HttpResponse.json([
        { id: 101, name: "品A", code: "DW-1" },
        { id: 102, name: "品B", code: "DW-2" },
      ]),
    ),
  )
}


/**
 * 画面に出してはいけない文言（docs/ui-writing-guidelines.md）。用語集の内部語と、否定形・因果の連鎖で
 * システムの振る舞いを説明する文
 */
export const FORBIDDEN_UI_TEXT = /当た|照合|候補|追いついていない|起票漏れ|自動では|しません|件数が変わ/

/** ページの見出し（h1）。件数を含めた名前で引く */
export function getPageHeading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 })
}
