import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { act, renderHook, waitFor } from "@/test-utils/render"
import { server } from "@/test-utils/msw/server"
import { API_BASE } from "@/test-utils/msw/handlers"
import { ApiError } from "@/lib/api-client"
import { processShiftErrorMessage, useProcessShiftPreview, useShiftProcess } from "./use-schedules"

const TARGET = { orderId: 1, processRoutingId: 12, workingDays: -2 }

function captureShift(): unknown[] {
  const bodies: unknown[] = []
  server.use(
    http.post(`${API_BASE}/orders/1/processes/12/shift`, async ({ request }) => {
      const body = (await request.json()) as { dry_run: boolean }
      bodies.push(body)
      return HttpResponse.json({ saved: !body.dry_run })
    }),
  )
  return bodies
}

describe("工程の前倒し・後ろ倒し（Issue #582）", () => {
  it("プレビューは dry_run で送る", async () => {
    const bodies = captureShift()
    const { result } = renderHook(() => useProcessShiftPreview())

    act(() => result.current.mutate(TARGET))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(bodies).toEqual([{ working_days: -2, dry_run: true }])
  })

  it("確定は dry_run=false で送る", async () => {
    const bodies = captureShift()
    const { result } = renderHook(() => useShiftProcess())

    act(() => result.current.mutate(TARGET))

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(bodies).toEqual([{ working_days: -2, dry_run: false }])
  })

  it("失敗の文言は既知のコードだけ固定文言にする", () => {
    expect(processShiftErrorMessage(new ApiError(409, { detail: { error: "schedule_changed" } }))).toBe(
      "計画が他の操作で変わりました。もう一度プレビューしてください",
    )
    expect(processShiftErrorMessage(new ApiError(403, { detail: "forbidden" }))).toBe("計画をずらす権限がありません")
    expect(processShiftErrorMessage(new ApiError(500, { detail: "boom" }))).toBe("計画をずらせませんでした")
    expect(processShiftErrorMessage(new Error("x"))).toBe("計画をずらせませんでした")
  })
})
