import { http, HttpResponse } from "msw"
import type { Product } from "@/types/product"

/** apiClient のベース URL（vitest.setup.ts で設定するものと揃える）。 */
export const API_BASE = "http://localhost:8000/api"

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

/**
 * デフォルトのハンドラ。個別テストは `server.use(...)` で上書きする。
 */
export const handlers = [
  http.get(`${API_BASE}/products`, () => HttpResponse.json(sampleProducts)),
]
