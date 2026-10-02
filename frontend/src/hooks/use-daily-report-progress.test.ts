import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { renderHook, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { ProcessProgress } from "@/types/daily-report-progress"
import {
  ORDER_PROGRESS_MAX_IDS,
  useOrderProgress,
  useOrderProgressList,
} from "./use-daily-report-progress"

const COMPUTED_AT = "2026-10-01T03:00:00Z"

function progress(orderId: number): ProcessProgress {
  return {
    order_id: orderId,
    process_routing_id: 11,
    sequence_order: 1,
    process_name: "プレス",
    good_qty: 10,
    order_quantity: 100,
    first_actual_date: "2026-09-10",
    last_actual_date: "2026-09-10",
    status: "in_progress",
    completed_by: null,
    planned_end_datetime: "2026-09-11T08:00:00Z",
  }
}

/** リクエストごとの `order_id` を記録し、その受注の進捗を1行ずつ返す */
function captureListRequests(): number[][] {
  const seen: number[][] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/order-progress`, ({ request }) => {
      const ids = new URL(request.url).searchParams.getAll("order_id").map(Number)
      seen.push(ids)
      return HttpResponse.json({ computed_at: COMPUTED_AT, items: ids.map(progress) })
    }),
  )
  return seen
}

describe("useOrderProgressList", () => {
  it("受注をまとめて1リクエストで引く（重複は除く）", async () => {
    const seen = captureListRequests()
    const { result } = renderHook(() => useOrderProgressList([3, 1, 3, 2]))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen).toEqual([[1, 2, 3]])
    expect(result.current.data?.computed_at).toBe(COMPUTED_AT)
    expect(result.current.data?.items.map((p) => p.order_id)).toEqual([1, 2, 3])
  })

  it("上限を超える件数は分割して取得し結合する", async () => {
    const seen = captureListRequests()
    const ids = Array.from({ length: ORDER_PROGRESS_MAX_IDS + 2 }, (_, i) => i + 1)
    const { result } = renderHook(() => useOrderProgressList(ids))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen.map((chunk) => chunk.length)).toEqual([ORDER_PROGRESS_MAX_IDS, 2])
    expect(result.current.data?.items).toHaveLength(ORDER_PROGRESS_MAX_IDS + 2)
  })

  it("受注が無い間は取得しない", () => {
    const seen = captureListRequests()
    const { result } = renderHook(() => useOrderProgressList([]))

    expect(result.current.fetchStatus).toBe("idle")
    expect(seen).toEqual([])
  })
})

describe("useOrderProgress", () => {
  it("受注1件の進捗を引く", async () => {
    server.use(
      http.get(`${API_BASE}/orders/7/progress`, () =>
        HttpResponse.json({ order_id: 7, computed_at: COMPUTED_AT, processes: [progress(7)] }),
      ),
    )
    const { result } = renderHook(() => useOrderProgress(7))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.processes).toHaveLength(1)
  })

  it("enabled: false の間は取得しない", () => {
    const { result } = renderHook(() => useOrderProgress(7, { enabled: false }))
    expect(result.current.fetchStatus).toBe("idle")
  })
})
