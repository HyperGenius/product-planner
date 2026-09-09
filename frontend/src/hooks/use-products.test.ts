import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { waitFor } from "@testing-library/react"
import { renderHook } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE, sampleProducts } from "@/test-utils/msw/handlers"
import { setSupabaseSession } from "@/test-utils/supabase"
import { useProducts } from "./use-products"

/**
 * TanStack Query を使うカスタムフックのサンプルテスト（Issue #340）。
 * ネットワークは MSW、認証 (`@/utils/supabase/client`) は setup で共通モック済み。
 */
describe("useProducts", () => {
  it("MSW が返す製品一覧を取得できる", async () => {
    const { result } = renderHook(() => useProducts())

    expect(result.current.isPending).toBe(true)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(sampleProducts)
  })

  it("API が 500 を返すとエラー状態になる（retry:false でハングしない）", async () => {
    server.use(
      http.get(`${API_BASE}/products`, () =>
        HttpResponse.json({ detail: "boom" }, { status: 500 }),
      ),
    )

    const { result } = renderHook(() => useProducts())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
  })

  it("未ログイン時は apiClient が Unauthorized で失敗する", async () => {
    setSupabaseSession(null)

    const { result } = renderHook(() => useProducts())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toEqual(new Error("Unauthorized"))
  })
})
