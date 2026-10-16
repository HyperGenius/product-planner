"use client"

import { useEffect, useState } from "react"

/** 値の変化が `delayMs` 止まってから反映する（入力に応じたAPI呼び出しを間引く用）。 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
