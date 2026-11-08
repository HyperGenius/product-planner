import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { toast } from "sonner"
import { BULK_INTERRUPTED_STORAGE_KEY, useBulkLeaveGuard } from "./use-bulk-leave-guard"

vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }))

describe("useBulkLeaveGuard", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.mocked(toast.warning).mockClear()
  })
  afterEach(() => window.localStorage.clear())

  it("実行中は beforeunload を止め、実行していなければ止めない", () => {
    const { rerender } = renderHook(({ p }) => useBulkLeaveGuard(p), {
      initialProps: { p: null as { label: string; done: number; total: number } | null },
    })
    const idle = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(idle)
    expect(idle.defaultPrevented).toBe(false)

    rerender({ p: { label: "一括承認", done: 1, total: 3 } })
    const busy = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(busy)
    expect(busy.defaultPrevented).toBe(true)
  })

  it("離脱（pagehide）で途中の件数を残す", () => {
    renderHook(() => useBulkLeaveGuard({ label: "一括承認", done: 2, total: 5 }))
    window.dispatchEvent(new Event("pagehide"))
    expect(JSON.parse(window.localStorage.getItem(BULK_INTERRUPTED_STORAGE_KEY)!)).toEqual({
      label: "一括承認",
      done: 2,
      total: 5,
    })
  })

  it("中断の印があれば開いたときに toast で知らせ、印を消す", () => {
    window.localStorage.setItem(
      BULK_INTERRUPTED_STORAGE_KEY,
      JSON.stringify({ label: "一括承認", done: 2, total: 5 }),
    )
    renderHook(() => useBulkLeaveGuard(null))
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain("2 / 5件")
    expect(window.localStorage.getItem(BULK_INTERRUPTED_STORAGE_KEY)).toBeNull()
  })

  it("不正な印は無視する", () => {
    window.localStorage.setItem(BULK_INTERRUPTED_STORAGE_KEY, JSON.stringify({ label: 1 }))
    renderHook(() => useBulkLeaveGuard(null))
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
