"use client"

import * as React from "react"

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange)
  return () => window.removeEventListener("hashchange", onChange)
}

const getSnapshot = () => window.location.hash
const getServerSnapshot = () => ""

/**
 * URL のハッシュ（`#` 付きの生の値）と、ハッシュを書き換える関数。画面で選んだカードを
 * 共有・ブックマーク・ブラウザの戻る操作で復元するために使う（Issue #639 / #654）。
 * 値は外部入力なので、呼び出し側で既知の値と照合してから使う
 */
export function useLocationHash(): [string, (value: string) => void] {
  const hash = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const setHash = React.useCallback((value: string) => {
    window.location.hash = value
  }, [])
  return [hash, setHash]
}
