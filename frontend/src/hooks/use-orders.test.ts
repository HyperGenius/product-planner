import { describe, expect, it, vi } from "vitest"
import { http, HttpResponse } from "msw"
import type { QueryClient } from "@tanstack/react-query"
import { act, renderHook } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { SHIPMENTS_QUERY_KEY } from "@/hooks/use-shipments"
import { useCreateOrder, useShipOrder, useUpdateOrder } from "./use-orders"

/**
 * 注文を変えたら、弥生の突合（`["shipments"]`）も取り直す（Issue #694）。
 * 送品の消し込みの件数（①③・前提）は突合から出るので、無効化しないと staleTime の間は古い件数のまま出る
 */
describe("注文のミューテーションと弥生の突合の無効化", () => {
  function spyInvalidations(queryClient: QueryClient) {
    const spy = vi.spyOn(queryClient, "invalidateQueries")
    return () => spy.mock.calls.map(([filters]) => filters?.queryKey)
  }

  it("作成のあとに注文と弥生の突合を無効化する", async () => {
    server.use(http.post(`${API_BASE}/orders`, () => HttpResponse.json({ id: 1 })))
    const { result, queryClient } = renderHook(() => useCreateOrder())
    const invalidated = spyInvalidations(queryClient)

    await act(() => result.current.mutateAsync({ product_id: 1, quantity: 1 }))

    expect(invalidated()).toEqual(expect.arrayContaining([["orders"], SHIPMENTS_QUERY_KEY]))
  })

  it("編集（顧客・製品・納期・注文番号）のあとに注文と弥生の突合を無効化する", async () => {
    server.use(http.patch(`${API_BASE}/orders/1`, () => HttpResponse.json({ id: 1 })))
    const { result, queryClient } = renderHook(() => useUpdateOrder())
    const invalidated = spyInvalidations(queryClient)

    await act(() => result.current.mutateAsync({ id: 1, data: { customer_id: 2 } }))

    expect(invalidated()).toEqual(expect.arrayContaining([["orders"], SHIPMENTS_QUERY_KEY]))
  })

  it("送品済みにするのあとに注文と弥生の突合を無効化する", async () => {
    server.use(http.post(`${API_BASE}/orders/1/ship`, () => HttpResponse.json({ id: 1 })))
    const { result, queryClient } = renderHook(() => useShipOrder())
    const invalidated = spyInvalidations(queryClient)

    await act(() => result.current.mutateAsync(1))

    expect(invalidated()).toEqual(expect.arrayContaining([["orders"], SHIPMENTS_QUERY_KEY]))
  })
})
