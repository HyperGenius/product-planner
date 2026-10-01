import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { act, renderHook, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import type { UnmatchedName } from "@/types/daily-report-names"
import {
  useIgnoreName,
  useNameEntries,
  useUnmatchedNames,
} from "./use-daily-report-names"

function captureEntriesQuery(): URLSearchParams[] {
  const seen: URLSearchParams[] = []
  server.use(
    http.get(`${API_BASE}/daily-reports/name-entries`, ({ request }) => {
      seen.push(new URL(request.url).searchParams)
      return HttpResponse.json([])
    }),
  )
  return seen
}

describe("useNameEntries", () => {
  it("製品は顧客先を付けて問い合わせる", async () => {
    const seen = captureEntriesQuery()
    const { result } = renderHook(() =>
      useNameEntries({ kind: "product", raw_text: "短いピン", customer_raw: "顧客A" }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Object.fromEntries(seen[0])).toEqual({
      kind: "product",
      raw_text: "短いピン",
      customer_raw: "顧客A",
    })
  })

  it("顧客先が空欄の製品は customer_raw を付けない（NULL の行）", async () => {
    const seen = captureEntriesQuery()
    const { result } = renderHook(() =>
      useNameEntries({ kind: "product", raw_text: "短いピン", customer_raw: null }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen[0].has("customer_raw")).toBe(false)
  })

  it("表記の記号（&・+ 等）もエンコードして送る", async () => {
    const seen = captureEntriesQuery()
    const { result } = renderHook(() =>
      useNameEntries({ kind: "process", raw_text: "カシメ&仕上げ+検査", customer_raw: null }),
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen[0].get("raw_text")).toBe("カシメ&仕上げ+検査")
  })

  it("null の間は取得しない", () => {
    const { result } = renderHook(() => useNameEntries(null))
    expect(result.current.fetchStatus).toBe("idle")
  })
})

describe("useIgnoreName", () => {
  it("対象外にしたら未照合一覧を取り直す。製品以外は顧客先を送らない", async () => {
    const item: UnmatchedName = {
      kind: "process",
      raw_text: "段取り",
      customer_raw: null,
      customer_id: null,
      entry_count: 3,
      last_work_date: "2026-09-01",
    }
    let unmatched: UnmatchedName[] = [item]
    let posted: unknown
    server.use(
      http.get(`${API_BASE}/daily-reports/unmatched-names`, () => HttpResponse.json(unmatched)),
      http.post(`${API_BASE}/daily-reports/ignored-names`, async ({ request }) => {
        posted = await request.json()
        unmatched = []
        return HttpResponse.json({ id: "x" }, { status: 201 })
      }),
    )

    const { result } = renderHook(() => ({
      list: useUnmatchedNames(),
      ignore: useIgnoreName(),
    }))
    await waitFor(() => expect(result.current.list.data).toHaveLength(1))

    await act(() => result.current.ignore.mutateAsync({ ...item, customer_raw: "顧客A" }))

    expect(posted).toEqual({ kind: "process", raw_text: "段取り", customer_raw: null })
    await waitFor(() => expect(result.current.list.data).toEqual([]))
  })
})
