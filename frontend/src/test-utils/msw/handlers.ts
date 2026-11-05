import { http, HttpResponse } from "msw"
import type { Product } from "@/types/product"
import type { Customer } from "@/types/customer"

/** apiClient のベース URL（vitest.setup.ts の NEXT_PUBLIC_API_URL と揃える）。 */
export const API_BASE = "http://localhost:8000"

export const sampleProducts: Product[] = [
  {
    id: 1,
    name: "テスト製品A",
    code: "P-001",
    is_active: true,
    has_process: true,
    has_unconfirmed_process: false,
    tenant_id: "tenant-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "テスト製品B",
    code: null,
    is_active: false,
    has_process: false,
    has_unconfirmed_process: true,
    tenant_id: "tenant-1",
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
]

export const sampleCustomers: Customer[] = [
  {
    id: 1,
    name: "テスト顧客A",
    status: "active",
    tenant_id: "tenant-1",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: 2,
    name: "テスト顧客B",
    status: "active",
    tenant_id: "tenant-1",
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  },
]

/**
 * デフォルトのハンドラ。個別テストは `server.use(...)` で上書きする。
 */
export const handlers = [
  http.get(`${API_BASE}/products`, () => HttpResponse.json(sampleProducts)),
  http.get(`${API_BASE}/customers`, () => HttpResponse.json(sampleCustomers)),
  http.get(`${API_BASE}/production-schedules`, () => HttpResponse.json([])),
  // 受注一覧の行が引く「未対応の督促」の件数（Issue #619）。既定は督促なし
  http.get(`${API_BASE}/orders/delivery-requests`, () => HttpResponse.json([])),
  http.get(`${API_BASE}/orders/delivery-requests/open-counts`, () => HttpResponse.json([])),
  // 督促・分納の依頼一覧が引く日報の進捗（Issue #635）。既定は進捗なし
  http.get(`${API_BASE}/daily-reports/order-progress`, () =>
    HttpResponse.json({ computed_at: null, items: [] }),
  ),
  // 日報の名寄せ（製品）の確認ダイアログ・行の展開部が引く顧客の未出荷受注（Issue #646）。既定は受注なし
  http.get(`${API_BASE}/daily-reports/customer-open-orders`, () => HttpResponse.json([])),
  // 受注詳細の「作り置きからの引き当て」（Issue #624）。既定は引き当てなし
  http.get(`${API_BASE}/daily-reports/orders/:orderId/stock-assignments`, () =>
    HttpResponse.json({
      computed_at: null,
      assignable: true,
      product_name: null,
      product_code: null,
      process_names: [],
      stock_estimates: [],
      assignments: [],
      candidates: {},
    }),
  ),
]
