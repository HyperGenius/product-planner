import { afterEach, describe, expect, it } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useLocalStorageState } from "./use-local-storage-state"

const KEY = "test-local-storage-state"
const DEFAULT = { n: 0 }
const parse = (value: unknown) =>
  typeof value === "object" && value !== null && typeof (value as { n?: unknown }).n === "number"
    ? (value as { n: number })
    : null

describe("useLocalStorageState", () => {
  afterEach(() => window.localStorage.clear())

  it("保存済みの値を読み、書き込むと同じタブの他の購読者にも反映する", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ n: 2 }))
    const a = renderHook(() => useLocalStorageState(KEY, DEFAULT, parse))
    const b = renderHook(() => useLocalStorageState(KEY, DEFAULT, parse))
    expect(a.result.current[0]).toEqual({ n: 2 })

    act(() => a.result.current[1]({ n: 5 }))
    expect(b.result.current[0]).toEqual({ n: 5 })
    expect(window.localStorage.getItem(KEY)).toBe('{"n":5}')
  })

  it("壊れた値・検証を通らない値は既定値", () => {
    window.localStorage.setItem(KEY, "{broken")
    expect(renderHook(() => useLocalStorageState(KEY, DEFAULT, parse)).result.current[0]).toBe(DEFAULT)
    window.localStorage.setItem(KEY, JSON.stringify({ n: "x" }))
    expect(renderHook(() => useLocalStorageState(KEY, DEFAULT, parse)).result.current[0]).toBe(DEFAULT)
  })
})
