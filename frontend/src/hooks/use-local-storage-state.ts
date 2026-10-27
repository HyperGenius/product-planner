"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"

/** 同じタブ内の書き込みを購読者へ知らせるイベント（`storage` イベントは他のタブでしか発火しない） */
const LOCAL_STORAGE_CHANGE_EVENT = "local-storage-state-change"

/** localStorage に書けなかった値（ストレージ無効の端末でも、開いている間は選んだ表示を保つ） */
const unsavedValues = new Map<string, string>()

function readRaw(key: string): string | null {
  if (unsavedValues.has(key)) return unsavedValues.get(key)!
  try {
    return window.localStorage.getItem(key)
  } catch {
    // プライベートモード・ストレージ無効では例外になる。覚えていない扱いにする
    return null
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange)
  window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, onChange)
  }
}

/**
 * localStorage に JSON で覚える状態（Issue #581）。
 *
 * `useSyncExternalStore` で読むので、SSR とハイドレーションの間は `defaultValue`（サーバーの値）で描き、
 * その直後に保存済みの値で描き直す（エフェクトで setState しない）。保存済みの値は別の端末・古い版が書いたものかも
 * しれない外部入力なので、`parse` で検証して既知の値だけを使う（不正なら `defaultValue`）。
 * `defaultValue` と `parse` は呼び出しごとに作り直さない（モジュールの定数・関数を渡す）こと
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  parse: (value: unknown) => T | null,
): [T, (next: T) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  )

  const value = useMemo(() => {
    if (raw === null) return defaultValue
    try {
      return parse(JSON.parse(raw)) ?? defaultValue
    } catch {
      return defaultValue
    }
  }, [raw, defaultValue, parse])

  const setValue = useCallback(
    (next: T) => {
      const json = JSON.stringify(next)
      try {
        window.localStorage.setItem(key, json)
        unsavedValues.delete(key)
      } catch {
        // 保存できなくても画面の操作は続ける（次に開いたときに覚えていないだけ）
        unsavedValues.set(key, json)
      }
      window.dispatchEvent(new Event(LOCAL_STORAGE_CHANGE_EVENT))
    },
    [key],
  )

  return [value, setValue]
}
